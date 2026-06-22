"""FastAPI app exposing the fuel optimizer + CII engine over HTTP.

Thin HTTP layer only: it validates input with the Pydantic schemas, calls the
existing engine functions from Phases 2-3 (voyage, optimizer, cii) and shapes
the response. No physics or optimization logic is reimplemented here.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from voyage import Leg
from optimizer import baseline_voyage, optimize_speed_profile
from cii import rate_voyage, CF
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


@app.post("/optimize", response_model=OptimizeResponse)
def optimize(req: OptimizeRequest):
    """Run baseline + optimized voyage, grade both on CII, return the comparison."""
    legs = [Leg(l.distance_nm, l.weather) for l in req.legs]
    distance = sum(leg.distance_nm for leg in legs)

    base = baseline_voyage(legs, req.service_speed)
    opt = optimize_speed_profile(legs, req.berth_eta_h, req.vmin, req.vmax)

    base_cii = rate_voyage(base["total_fuel"], req.dwt, distance, req.year)
    opt_cii = rate_voyage(opt["total_fuel"], req.dwt, distance, req.year)

    saving_pct = (base["total_fuel"] - opt["total_fuel"]) / base["total_fuel"] * 100
    co2_saved_t = (base["total_fuel"] - opt["total_fuel"]) * CF

    baseline_out = ScenarioOut(
        fuel_t=base["total_fuel"],
        total_time_h=base["total_time_h"],
        attained_cii=base_cii["attained"],
        cii_ratio=base_cii["ratio"],
        cii_grade=base_cii["grade"],
        speeds=None,
    )
    optimized_out = ScenarioOut(
        fuel_t=opt["total_fuel"],
        total_time_h=opt["total_time_h"],
        attained_cii=opt_cii["attained"],
        cii_ratio=opt_cii["ratio"],
        cii_grade=opt_cii["grade"],
        speeds=opt["speeds"],
    )

    return OptimizeResponse(
        baseline=baseline_out,
        optimized=optimized_out,
        saving_pct=saving_pct,
        co2_saved_t=co2_saved_t,
        distance_nm=distance,
    )
