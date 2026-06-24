"""FastAPI app exposing the fuel optimizer + CII engine over HTTP.

Thin HTTP layer only: it validates input with the Pydantic schemas, calls the
existing engine functions from Phases 2-3 (voyage, optimizer, cii) and shapes
the response. No physics or optimization logic is reimplemented here.
"""

import json
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from voyage import (
    Leg,
    leg_fuel,
    leg_time,
    leg_sog,
    relative_wind_deg,
    wind_angle_rad_from,
    current_along_kn,
    weather_factor_to_wave_m,
)
from optimizer import baseline_voyage, optimize_speed_profile
from cii import rate_voyage, CF
from ports import curated_ports, search_ports, resolve_latlon, nearest_port
from routing import (
    get_sea_route,
    resample_to_legs,
    leg_midpoints,
    leg_bearings,
    legs_for_distance,
    polyline_distance_nm,
)
from weather import fetch_leg_weather
from economics import (
    fuel_cost_usd,
    blended_fuel_cost_usd,
    ets_cost_eur,
    PRICES_USD_PER_T,
    ETS_EUR_PER_TCO2,
)
from zones import eca_split, ECA_ZONES
from vessels import VESSELS, fetch_vessel
from alt_routes import (
    crosses_hra,
    hra_avoiding_route,
    weather_current_route,
    worst_leg_index,
)
from schemas import OptimizeRequest, OptimizeResponse, ScenarioOut, PerLegOut

app = FastAPI(title="Tanker Fuel Optimizer API")

# Bundled maritime zone polygons for the map (loaded once; offline-first).
_ZONES_GEOJSON_PATH = os.path.join(os.path.dirname(__file__), "data", "zones.geojson")
with open(_ZONES_GEOJSON_PATH, encoding="utf-8") as _f:
    _ZONES_GEOJSON = json.load(_f)

# DEV ONLY: allow any localhost / 127.0.0.1 port. The Next.js dev server hops to
# the next free port (3000 -> 3001 -> 3002 ...) when earlier ones are taken, so a
# hardcoded port list breaks as soon as it lands somewhere unlisted. A regex over
# localhost ports is robust to that. (A wildcard "*" is invalid with credentials
# per the CORS spec; the regex echoes the matched origin instead.) Replace with
# the real frontend origin in production.
ALLOWED_ORIGIN_REGEX = r"http://(localhost|127\.0\.0\.1):\d+"
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    """Liveness probe — returns a simple OK payload."""
    return {"status": "ok"}


@app.get("/ports")
def list_ports():
    """Small curated default port list for the initial UI (backward compatible)."""
    return curated_ports()


@app.get("/ports/search")
def ports_search(q: str, limit: int = 20):
    """Search the full WPI port database by name or country (autocomplete)."""
    return search_ports(q, limit)


@app.get("/ports/nearest")
def ports_nearest(lat: float, lon: float):
    """Closest named port to a clicked map point (for click-to-pick origin/dest)."""
    port = nearest_port(lat, lon)
    if port is None:
        raise HTTPException(status_code=404, detail="No ports available.")
    return port


@app.get("/zones")
def zones():
    """Maritime zone polygons (ECA + piracy HRA) as GeoJSON, for the map to draw."""
    return _ZONES_GEOJSON


@app.get("/vessels")
def list_vessels():
    """Static fleet list (imo + display name) for the dropdown. No API call."""
    return [{"imo": v["imo"], "name": v["name"]} for v in VESSELS]


@app.get("/vessels/{imo}")
async def vessel_detail(imo: int):
    """Live AIS data for one fleet vessel (VesselFinder, cached >= 1 h).

    Returns {available: False, reason} gracefully when the key is missing or the
    trial is over its hourly limit — it never raises, so the demo keeps working.
    """
    if imo not in {v["imo"] for v in VESSELS}:
        raise HTTPException(status_code=404, detail="Unknown vessel IMO.")
    return await fetch_vessel(imo)


@app.get("/prices")
def reference_prices():
    """Editable REFERENCE prices (not live): bunker USD/ton and EU ETS EUR/tCO2."""
    return {
        "fuel_prices_usd_per_t": PRICES_USD_PER_T,
        "ets_eur_per_tco2": ETS_EUR_PER_TCO2,
    }


@app.get("/route_info")
def route_info(origin: str, dest: str, num_legs: int | None = None):
    """Timing facts for a route, so the frontend can default the ETA sensibly.

    Returns the route distance plus three reference times:
      - min_time_h:      all legs at vmax (16 kn) = earliest possible arrival.
      - baseline_time_h: all legs at service speed (14 kn).
      - suggested_eta_h: baseline_time * 1.12, giving the ship modest slack to
        slow down below service speed — which is what makes the optimizer save
        fuel. Tighter slack (1.12) yields a realistic, defensible saving (~C
        grade) rather than aggressive slow-steaming (1.25 lands on ~A grade).

    Reuses the real sea route (routing.py) and the leg-time helper (voyage.py).
    """
    origin_ll = resolve_latlon(origin)
    dest_ll = resolve_latlon(dest)
    if origin_ll is None:
        raise HTTPException(status_code=400, detail=f"Unknown origin: {origin}")
    if dest_ll is None:
        raise HTTPException(status_code=400, detail=f"Unknown dest: {dest}")

    route = get_sea_route(origin_ll, dest_ll)
    # Distance-based leg count unless the caller forces one (so the frontend can
    # size its weather sliders + leg markers to the same count the optimizer uses).
    n_legs = num_legs or legs_for_distance(route["distance_nm"])
    legs = resample_to_legs(route["coords_latlon"], n_legs)

    vmax = 16.0
    service_speed = 14.0
    min_time_h = sum(leg_time(vmax, leg) for leg in legs)
    baseline_time_h = sum(leg_time(service_speed, leg) for leg in legs)
    suggested_eta_h = round(baseline_time_h * 1.12)

    return {
        "distance_nm": route["distance_nm"],
        "num_legs": n_legs,
        "min_time_h": min_time_h,
        "baseline_time_h": baseline_time_h,
        "suggested_eta_h": suggested_eta_h,
    }


@app.post("/optimize", response_model=OptimizeResponse)
async def optimize(req: OptimizeRequest):
    """Run baseline + optimized voyage, grade both on CII, return the comparison.

    Two input modes:
      - Real routing: if both `origin` and `dest` are given (each a known port
        name or a "lat,lon" string), build the real sea lane, resample it into
        `num_legs` legs, and return route_coords. When `auto_weather` is true,
        per-leg weather factors come from live Open-Meteo marine data.
      - Legacy: otherwise use the explicit `legs` provided in the request.
    """
    route_coords = None
    legs_weather = None

    if req.origin and req.dest:
        # Real sea-routing path. origin/dest may be a known port name or "lat,lon".
        origin_ll = resolve_latlon(req.origin)
        dest_ll = resolve_latlon(req.dest)
        if origin_ll is None:
            raise HTTPException(status_code=400, detail=f"Unknown origin: {req.origin}")
        if dest_ll is None:
            raise HTTPException(status_code=400, detail=f"Unknown dest: {req.dest}")
        route = get_sea_route(origin_ll, dest_ll)
        route_coords = route["coords_latlon"]
        # Distance-based leg count unless the request forces one: roughly one leg
        # per 500 nm (clamped 3..12), so long voyages get finer segmentation.
        n_legs = req.num_legs or legs_for_distance(route["distance_nm"])

        if req.auto_weather:
            # Live weather overrides the manual sliders: query each leg's midpoint
            # concurrently and turn the result into the per-leg fuel inputs —
            # wave height -> weather factor (Hs), wind speed -> Beaufort, and
            # wind direction vs the leg heading -> the wind/heading angle.
            mids = leg_midpoints(route_coords, n_legs)
            bearings = leg_bearings(route_coords, n_legs)
            legs_weather = await fetch_leg_weather(mids)

            weather = []
            beaufort = []
            wind_angle = []
            current = []
            for lw, brng in zip(legs_weather, bearings):
                weather.append(lw["factor"])
                beaufort.append(lw.get("beaufort") or 0.0)
                wind_dir = lw.get("wind_dir")
                if wind_dir is not None:
                    theta_deg = relative_wind_deg(wind_dir, brng)
                    wind_angle.append(wind_angle_rad_from(wind_dir, brng))
                else:
                    theta_deg = None
                    wind_angle.append(0.0)  # no wind data -> calm baseline
                # Project the ocean current onto this leg's heading (+ following).
                cur_kn = lw.get("current_kn") or 0.0
                cur_dir = lw.get("current_dir")
                along = current_along_kn(cur_kn, cur_dir, brng) if cur_dir is not None else 0.0
                current.append(along)
                # Enrich the per-leg meta returned to the client.
                lw["bearing_deg"] = round(brng, 1)
                lw["theta_deg"] = round(theta_deg, 1) if theta_deg is not None else None
            legs = resample_to_legs(
                route_coords, n_legs, weather, beaufort, wind_angle, current
            )
        else:
            weather = req.weather
            legs = resample_to_legs(route_coords, n_legs, weather)
    elif req.legs:
        # Legacy explicit-legs path (backward compatible).
        legs = [Leg(l.distance_nm, l.weather) for l in req.legs]
    else:
        raise HTTPException(
            status_code=400,
            detail="Provide either origin+dest (port names) or explicit legs.",
        )

    distance = sum(leg.distance_nm for leg in legs)

    base = baseline_voyage(
        legs, req.service_speed, req.draft_dm, req.load, req.days_since_drydock
    )
    opt = optimize_speed_profile(
        legs,
        req.berth_eta_h,
        req.vmin,
        req.vmax,
        req.draft_dm,
        req.load,
        req.days_since_drydock,
    )

    # Report each leg's optimized speed over ground (STW + along-track current).
    if legs_weather is not None:
        for lw, leg, stw in zip(legs_weather, legs, opt["speeds"]):
            lw["sog_kn"] = round(leg_sog(stw, leg), 2)

    # Per-leg optimized breakdown (reuses the engine's own leg_fuel / leg_sog, no
    # new physics) so the UI can surface each leg's FUEL next to its conditions
    # and draw the leg boundaries on the map.
    per_leg = [
        PerLegOut(
            leg_index=i,
            distance_nm=round(leg.distance_nm, 1),
            speed_kn=round(stw, 2),
            fuel_t=round(
                leg_fuel(stw, leg, req.draft_dm, req.load, req.days_since_drydock), 2
            ),
            baseline_fuel_t=round(
                leg_fuel(
                    req.service_speed, leg, req.draft_dm, req.load, req.days_since_drydock
                ),
                2,
            ),
            weather_factor=round(leg.weather, 3),
            beaufort=round(leg.beaufort, 1),
            wave_m=round(weather_factor_to_wave_m(leg.weather), 2),
            current_kn=round(leg.current_along_kn, 2),
            sog_kn=round(leg_sog(stw, leg), 2),
        )
        for i, (leg, stw) in enumerate(zip(legs, opt["speeds"]))
    ]

    base_cii = rate_voyage(base["total_fuel"], req.dwt, distance, req.year)
    opt_cii = rate_voyage(opt["total_fuel"], req.dwt, distance, req.year)

    saving_pct = (base["total_fuel"] - opt["total_fuel"]) / base["total_fuel"] * 100
    co2_saved_t = (base["total_fuel"] - opt["total_fuel"]) * CF

    # Economics: cost per scenario (reuse economics.py; reference prices unless
    # the request overrides them).
    prices = req.fuel_prices or PRICES_USD_PER_T
    ets = req.ets_price if req.ets_price is not None else ETS_EUR_PER_TCO2

    base_fuel_cost = fuel_cost_usd(base["total_fuel"], req.fuel_type, prices)
    opt_fuel_cost = fuel_cost_usd(opt["total_fuel"], req.fuel_type, prices)
    base_ets = ets_cost_eur(base["total_fuel"] * CF, req.eu_scope_fraction, ets)
    opt_ets = ets_cost_eur(opt["total_fuel"] * CF, req.eu_scope_fraction, ets)

    # ECA-aware costing for routed voyages: fuel inside an ECA must be the pricier
    # low-sulphur grade. Compute the split once (same route for both scenarios)
    # and blend each scenario's cost. Legacy legs-only calls keep the flat cost.
    eca_nm = non_eca_nm = 0.0
    base_blended = opt_blended = 0.0
    eca_zones_out = None
    if route_coords:
        eca_nm, non_eca_nm = eca_split(route_coords)
        base_blended = blended_fuel_cost_usd(
            base["total_fuel"], eca_nm, non_eca_nm, prices=prices
        )
        opt_blended = blended_fuel_cost_usd(
            opt["total_fuel"], eca_nm, non_eca_nm, prices=prices
        )
        eca_zones_out = ECA_ZONES
        money_saved_usd = base_blended - opt_blended
    else:
        money_saved_usd = base_fuel_cost - opt_fuel_cost

    baseline_out = ScenarioOut(
        fuel_t=base["total_fuel"],
        total_time_h=base["total_time_h"],
        attained_cii=base_cii["attained"],
        cii_ratio=base_cii["ratio"],
        cii_grade=base_cii["grade"],
        speeds=None,
        fuel_cost_usd=base_fuel_cost,
        ets_cost_eur=base_ets,
        eca_nm=eca_nm,
        non_eca_nm=non_eca_nm,
        blended_fuel_cost_usd=base_blended,
    )
    optimized_out = ScenarioOut(
        fuel_t=opt["total_fuel"],
        total_time_h=opt["total_time_h"],
        attained_cii=opt_cii["attained"],
        cii_ratio=opt_cii["ratio"],
        cii_grade=opt_cii["grade"],
        speeds=opt["speeds"],
        fuel_cost_usd=opt_fuel_cost,
        ets_cost_eur=opt_ets,
        eca_nm=eca_nm,
        non_eca_nm=non_eca_nm,
        blended_fuel_cost_usd=opt_blended,
    )

    return OptimizeResponse(
        baseline=baseline_out,
        optimized=optimized_out,
        saving_pct=saving_pct,
        co2_saved_t=co2_saved_t,
        money_saved_usd=money_saved_usd,
        distance_nm=distance,
        num_legs=len(legs),
        per_leg=per_leg,
        route_coords=route_coords,
        eca_zones=eca_zones_out,
        feasible=opt["feasible"],
        min_time_h=opt["min_time_h"],
        legs_weather=legs_weather,
    )


async def _legs_and_weather(route_coords, req, n_legs):
    """Resample a route into legs, with live weather+current when auto_weather.

    Mirrors the auto-weather leg-building used by /optimize (kept separate so the
    /optimize handler stays untouched). Returns (legs, legs_weather) where each
    leg carries the per-leg Beaufort, wind angle and along-track current; the
    returned legs_weather dicts are enriched with bearing/theta/current_along for
    the client and for the worst-leg pick.
    """
    if req.auto_weather:
        mids = leg_midpoints(route_coords, n_legs)
        bearings = leg_bearings(route_coords, n_legs)
        legs_weather = await fetch_leg_weather(mids)
        weather, beaufort, wind_angle, current = [], [], [], []
        for lw, brng in zip(legs_weather, bearings):
            weather.append(lw["factor"])
            beaufort.append(lw.get("beaufort") or 0.0)
            wind_dir = lw.get("wind_dir")
            if wind_dir is not None:
                theta_deg = relative_wind_deg(wind_dir, brng)
                wind_angle.append(wind_angle_rad_from(wind_dir, brng))
            else:
                theta_deg = None
                wind_angle.append(0.0)
            cur_kn = lw.get("current_kn") or 0.0
            cur_dir = lw.get("current_dir")
            along = current_along_kn(cur_kn, cur_dir, brng) if cur_dir is not None else 0.0
            current.append(along)
            lw["current_along_kn"] = round(along, 3)
            lw["bearing_deg"] = round(brng, 1)
            lw["theta_deg"] = round(theta_deg, 1) if theta_deg is not None else None
        legs = resample_to_legs(
            route_coords, n_legs, weather, beaufort, wind_angle, current
        )
        return legs, legs_weather
    legs = resample_to_legs(route_coords, n_legs, req.weather)
    return legs, None


async def _score_candidate(cid, label, route_coords, req, approx=False):
    """Score one candidate route end-to-end with the existing engine.

    Runs the same baseline + optimized pipeline as /optimize (fuel, time, CII,
    ECA-blended cost) on this candidate's geometry and returns a flat summary
    dict (including the baseline figures so the UI can show "X -> Y").
    """
    # Each candidate gets its own distance-based leg count (unless forced), so a
    # long Cape-of-Good-Hope lane is segmented finer than the short direct one.
    n_legs = req.num_legs or legs_for_distance(polyline_distance_nm(route_coords))
    legs, legs_weather = await _legs_and_weather(route_coords, req, n_legs)
    distance = sum(leg.distance_nm for leg in legs)

    base = baseline_voyage(
        legs, req.service_speed, req.draft_dm, req.load, req.days_since_drydock
    )
    opt = optimize_speed_profile(
        legs,
        req.berth_eta_h,
        req.vmin,
        req.vmax,
        req.draft_dm,
        req.load,
        req.days_since_drydock,
    )
    if legs_weather is not None:
        for lw, leg, stw in zip(legs_weather, legs, opt["speeds"]):
            lw["sog_kn"] = round(leg_sog(stw, leg), 2)

    base_cii = rate_voyage(base["total_fuel"], req.dwt, distance, req.year)
    opt_cii = rate_voyage(opt["total_fuel"], req.dwt, distance, req.year)

    eca_nm, non_eca_nm = eca_split(route_coords)
    prices = req.fuel_prices or PRICES_USD_PER_T
    base_cost = blended_fuel_cost_usd(base["total_fuel"], eca_nm, non_eca_nm, prices=prices)
    opt_cost = blended_fuel_cost_usd(opt["total_fuel"], eca_nm, non_eca_nm, prices=prices)

    saving_pct = (base["total_fuel"] - opt["total_fuel"]) / base["total_fuel"] * 100
    co2_saved_t = (base["total_fuel"] - opt["total_fuel"]) * CF

    return {
        "id": cid,
        "label": label,
        "recommended": False,
        "approx": approx,
        "feasible": opt["feasible"],
        "route_coords": route_coords,
        "legs_weather": legs_weather,
        "distance_nm": distance,
        "total_time_h": opt["total_time_h"],
        "fuel_t": opt["total_fuel"],
        "baseline_fuel_t": base["total_fuel"],
        "saving_pct": saving_pct,
        "co2_saved_t": co2_saved_t,
        "cii_grade": opt_cii["grade"],
        "cii_attained": opt_cii["attained"],
        "cii_ratio": opt_cii["ratio"],
        "baseline_cii_grade": base_cii["grade"],
        "baseline_cii_attained": base_cii["attained"],
        "baseline_cii_ratio": base_cii["ratio"],
        "cost_usd": opt_cost,
        "baseline_cost_usd": base_cost,
        "money_saved_usd": base_cost - opt_cost,
        "money_vs_shortest": 0.0,  # filled in once the shortest cost is known
        "speeds": opt["speeds"],
        "eca_nm": eca_nm,
        "crosses_hra": crosses_hra(route_coords),
        "min_time_h": opt["min_time_h"],
    }


@app.post("/alternatives")
async def alternatives(req: OptimizeRequest):
    """Generate and score 2-4 candidate routes for side-by-side comparison.

    Same inputs as /optimize, but requires origin+dest. Returns a list of scored
    candidates (shortest, optionally an HRA-avoiding lane, and optionally a
    weather/current waypoint-nudge), with the lowest-fuel feasible one flagged
    `recommended`. The single-route /optimize flow is unchanged.
    """
    if not (req.origin and req.dest):
        raise HTTPException(
            status_code=400, detail="Provide origin+dest port names or coords."
        )
    origin_ll = resolve_latlon(req.origin)
    dest_ll = resolve_latlon(req.dest)
    if origin_ll is None:
        raise HTTPException(status_code=400, detail=f"Unknown origin: {req.origin}")
    if dest_ll is None:
        raise HTTPException(status_code=400, detail=f"Unknown dest: {req.dest}")

    # 1) Shortest (default) lane — always present, and the cost reference.
    shortest_route = get_sea_route(origin_ll, dest_ll)
    shortest = await _score_candidate(
        "shortest", "En Kısa Rota", shortest_route["coords_latlon"], req
    )
    candidates = [shortest]

    # 2) HRA-avoiding lane — only when the shortest route crosses the HRA.
    if shortest["crosses_hra"]:
        hra = hra_avoiding_route(origin_ll, dest_ll)
        if hra is not None and not crosses_hra(hra["coords_latlon"]):
            candidates.append(
                await _score_candidate(
                    "hra_avoiding",
                    "Korsanlıktan Kaçınan",
                    hra["coords_latlon"],
                    req,
                )
            )

    # 3) Weather/current waypoint-nudge — only with live data and a worst leg.
    if req.auto_weather and shortest["legs_weather"]:
        widx = worst_leg_index(shortest["legs_weather"])
        # Use the SAME leg count the shortest candidate was segmented into, so the
        # worst-leg midpoint lines up with the leg `widx` came from.
        shortest_n_legs = req.num_legs or legs_for_distance(shortest_route["distance_nm"])
        wc = weather_current_route(
            origin_ll, dest_ll, shortest_route["coords_latlon"], widx, shortest_n_legs
        )
        if wc is not None:
            candidates.append(
                await _score_candidate(
                    "weather_current_optimized",
                    "Hava/Akıntı Optimize",
                    wc["coords_latlon"],
                    req,
                    approx=True,
                )
            )

    # Money difference vs the shortest lane.
    ref_cost = shortest["cost_usd"]
    for c in candidates:
        c["money_vs_shortest"] = c["cost_usd"] - ref_cost

    # Recommend the lowest-fuel FEASIBLE candidate (fall back to all if none).
    pool = [c for c in candidates if c["feasible"]] or candidates
    min(pool, key=lambda c: c["fuel_t"])["recommended"] = True

    return candidates
