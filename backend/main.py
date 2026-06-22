"""FastAPI app exposing the fuel optimizer + CII engine over HTTP.

Thin HTTP layer only: it validates input with the Pydantic schemas, calls the
existing engine functions from Phases 2-3 (voyage, optimizer, cii) and shapes
the response. No physics or optimization logic is reimplemented here.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from voyage import Leg, leg_time
from optimizer import baseline_voyage, optimize_speed_profile
from cii import rate_voyage, CF
from ports import curated_ports, search_ports, resolve_latlon
from routing import get_sea_route, resample_to_legs, leg_midpoints
from weather import fetch_leg_weather
from economics import (
    fuel_cost_usd,
    blended_fuel_cost_usd,
    ets_cost_eur,
    PRICES_USD_PER_T,
    ETS_EUR_PER_TCO2,
)
from zones import eca_split, ECA_ZONES
from schemas import OptimizeRequest, OptimizeResponse, ScenarioOut

app = FastAPI(title="Tanker Fuel Optimizer API")

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


@app.get("/prices")
def reference_prices():
    """Editable REFERENCE prices (not live): bunker USD/ton and EU ETS EUR/tCO2."""
    return {
        "fuel_prices_usd_per_t": PRICES_USD_PER_T,
        "ets_eur_per_tco2": ETS_EUR_PER_TCO2,
    }


@app.get("/route_info")
def route_info(origin: str, dest: str, num_legs: int = 6):
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
    legs = resample_to_legs(route["coords_latlon"], num_legs)

    vmax = 16.0
    service_speed = 14.0
    min_time_h = sum(leg_time(vmax, leg) for leg in legs)
    baseline_time_h = sum(leg_time(service_speed, leg) for leg in legs)
    suggested_eta_h = round(baseline_time_h * 1.12)

    return {
        "distance_nm": route["distance_nm"],
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

        if req.auto_weather:
            # Live weather overrides the manual sliders: query each leg's midpoint
            # concurrently and turn wave height into the per-leg weather factor.
            mids = leg_midpoints(route_coords, req.num_legs)
            legs_weather = await fetch_leg_weather(mids)
            weather = [lw["factor"] for lw in legs_weather]
        else:
            weather = req.weather
        legs = resample_to_legs(route_coords, req.num_legs, weather)
    elif req.legs:
        # Legacy explicit-legs path (backward compatible).
        legs = [Leg(l.distance_nm, l.weather) for l in req.legs]
    else:
        raise HTTPException(
            status_code=400,
            detail="Provide either origin+dest (port names) or explicit legs.",
        )

    distance = sum(leg.distance_nm for leg in legs)

    base = baseline_voyage(legs, req.service_speed)
    opt = optimize_speed_profile(legs, req.berth_eta_h, req.vmin, req.vmax)

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
        route_coords=route_coords,
        eca_zones=eca_zones_out,
        feasible=opt["feasible"],
        min_time_h=opt["min_time_h"],
        legs_weather=legs_weather,
    )
