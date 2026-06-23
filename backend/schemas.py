"""Pydantic request/response models for the optimizer HTTP API.

These models define the JSON contract of the API and validate incoming data
(e.g. distances must be positive, weather at least 1.0) before it ever reaches
the engine. They mirror the domain objects from Phases 2-3 but live at the API
boundary so the core engine stays free of HTTP concerns.
"""

from pydantic import BaseModel, Field


class LegIn(BaseModel):
    """One voyage leg as sent by the client."""

    distance_nm: float = Field(..., gt=0, description="Leg distance in nautical miles.")
    weather: float = Field(
        1.0, ge=1.0, description="Fuel penalty: 1.0 calm, >1.0 rougher water."
    )


class OptimizeRequest(BaseModel):
    """Full request body for POST /optimize."""

    # Explicit legs (legacy path). Optional now: when origin+dest are given, the
    # route is built from the sea lane instead and these are ignored.
    legs: list[LegIn] | None = Field(
        None, description="Voyage legs in order (ignored if origin+dest given)."
    )
    dwt: float = Field(..., gt=0, description="Vessel deadweight tonnage.")
    service_speed: float = Field(
        14.0, description="Constant speed used for the baseline voyage, in knots."
    )
    berth_eta_h: float = Field(
        ..., gt=0, description="Arrive-by time budget, in hours."
    )
    year: int = Field(2026, description="Calendar year for the CII rating.")
    vmin: float = Field(10.0, description="Minimum allowed per-leg speed, in knots.")
    vmax: float = Field(16.0, description="Maximum allowed per-leg speed, in knots.")

    # Vessel inputs for the log-linear fuel model (optional; sensible defaults).
    draft_dm: float = Field(
        12.0, gt=0, description="Mean draft Dm, in metres (fuel model input)."
    )
    days_since_drydock: float = Field(
        180.0, ge=0, description="Days since last drydock (hull-fouling proxy)."
    )
    load: float = Field(
        0.5, ge=0, le=1, description="Load/ballast state: 0 ballast .. 1 fully laden."
    )

    # Real sea-routing path (optional). When both are set to known port names,
    # the backend builds a real ocean route and resamples it into num_legs legs.
    origin: str | None = Field(None, description="Origin port name (see /ports).")
    dest: str | None = Field(None, description="Destination port name (see /ports).")
    num_legs: int = Field(6, gt=0, description="How many legs to resample the route into.")
    weather: list[float] | None = Field(
        None, description="Optional per-leg weather factors (used when auto_weather is off)."
    )
    auto_weather: bool = Field(
        True, description="If true, fetch live marine weather to set per-leg factors."
    )

    # Economics inputs (optional; reference prices used when omitted).
    fuel_type: str = Field("VLSFO", description="Bunker grade: VLSFO/LSMGO/HSFO.")
    fuel_prices: dict[str, float] | None = Field(
        None, description="Override USD/ton prices per fuel type; None = reference."
    )
    ets_price: float | None = Field(
        None, description="Override EU ETS EUR/tCO2 price; None = reference."
    )
    eu_scope_fraction: float = Field(
        0.0, description="Share of voyage CO2 inside EU ETS scope (0..1)."
    )


class ScenarioOut(BaseModel):
    """One scenario's result (baseline or optimized), graded on CII."""

    fuel_t: float = Field(..., description="Total fuel burned, in metric tons.")
    total_time_h: float = Field(..., description="Total sailing time, in hours.")
    attained_cii: float = Field(..., description="Attained CII, g CO2 / (dwt*nm).")
    cii_ratio: float = Field(..., description="Attained / required CII ratio.")
    cii_grade: str = Field(..., description="IMO CII grade, A (best) to E (worst).")
    speeds: list[float] | None = Field(
        None, description="Per-leg speeds in knots; None for the baseline scenario."
    )
    fuel_cost_usd: float = Field(..., description="Fuel cost of the scenario, in USD.")
    ets_cost_eur: float = Field(..., description="EU ETS carbon cost, in EUR.")
    eca_nm: float = Field(0.0, description="Distance sailed inside ECAs, in nm.")
    non_eca_nm: float = Field(0.0, description="Distance sailed outside ECAs, in nm.")
    blended_fuel_cost_usd: float = Field(
        0.0, description="Fuel cost with ECA/open-sea fuel split, in USD."
    )


class OptimizeResponse(BaseModel):
    """Full response body for POST /optimize."""

    baseline: ScenarioOut = Field(..., description="Constant-service-speed scenario.")
    optimized: ScenarioOut = Field(..., description="Fuel-minimizing scenario.")
    saving_pct: float = Field(..., description="Fuel saved, percent of baseline.")
    co2_saved_t: float = Field(..., description="CO2 saved, in metric tons.")
    money_saved_usd: float = Field(..., description="Fuel cost saved, in USD.")
    distance_nm: float = Field(..., description="Total voyage distance, in nm.")
    route_coords: list[list[float]] | None = Field(
        None, description="[lat, lon] points of the real sea lane; None for legacy legs."
    )
    eca_zones: list[dict] | None = Field(
        None, description="Approximate ECA boxes (name + bbox), for drawing."
    )
    legs_weather: list[dict] | None = Field(
        None, description="Per-leg live weather meta: {factor, wave_m, source}."
    )
    feasible: bool = Field(
        True, description="False if the deadline is unreachable even at full speed."
    )
    min_time_h: float = Field(
        0.0, description="Fastest possible voyage time (all legs at vmax), in hours."
    )
