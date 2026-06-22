"""FastAPI app exposing the fuel optimizer + CII engine over HTTP.

Thin HTTP layer only: it validates input with the Pydantic schemas, calls the
existing engine functions from Phases 2-3 (voyage, optimizer, cii) and shapes
the response. No physics or optimization logic is reimplemented here.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from voyage import Leg
from optimizer import baseline_voyage, optimize_speed_profile
from cii import rate_voyage, CF
from ports import PORTS
from routing import get_sea_route, resample_to_legs
from economics import (
    fuel_cost_usd,
    ets_cost_eur,
    PRICES_USD_PER_T,
    ETS_EUR_PER_TCO2,
)
from schemas import OptimizeRequest, OptimizeResponse, ScenarioOut

app = FastAPI(title="Tanker Fuel Optimizer API")

# DEV ONLY: explicit local frontend origins. The Next.js dev server runs on
# :3000, but falls back to :3001 when :3000 is taken, so we allow both — for
# localhost and 127.0.0.1, since the two are distinct origins to the browser.
# Note: an explicit list (not ["*"]) is required when allow_credentials=True;
# the wildcard is invalid with credentials per the CORS spec. Replace these
# with the real frontend origin in production.
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
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
    """List known port names (for the frontend origin/destination dropdowns)."""
    return list(PORTS.keys())


@app.get("/prices")
def reference_prices():
    """Editable REFERENCE prices (not live): bunker USD/ton and EU ETS EUR/tCO2."""
    return {
        "fuel_prices_usd_per_t": PRICES_USD_PER_T,
        "ets_eur_per_tco2": ETS_EUR_PER_TCO2,
    }


@app.post("/optimize", response_model=OptimizeResponse)
def optimize(req: OptimizeRequest):
    """Run baseline + optimized voyage, grade both on CII, return the comparison.

    Two input modes:
      - Real routing: if both `origin` and `dest` are known port names, build the
        real sea lane, resample it into `num_legs` legs, and return route_coords.
      - Legacy: otherwise use the explicit `legs` provided in the request.
    """
    route_coords = None

    if req.origin and req.dest:
        # Real sea-routing path.
        if req.origin not in PORTS:
            raise HTTPException(status_code=400, detail=f"Unknown origin: {req.origin}")
        if req.dest not in PORTS:
            raise HTTPException(status_code=400, detail=f"Unknown dest: {req.dest}")
        route = get_sea_route(PORTS[req.origin], PORTS[req.dest])
        route_coords = route["coords_latlon"]
        legs = resample_to_legs(route_coords, req.num_legs, req.weather)
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
    )

    return OptimizeResponse(
        baseline=baseline_out,
        optimized=optimized_out,
        saving_pct=saving_pct,
        co2_saved_t=co2_saved_t,
        money_saved_usd=money_saved_usd,
        distance_nm=distance,
        route_coords=route_coords,
    )
