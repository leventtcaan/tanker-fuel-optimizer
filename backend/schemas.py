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

    legs: list[LegIn] = Field(..., min_length=1, description="Voyage legs in order.")
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


class OptimizeResponse(BaseModel):
    """Full response body for POST /optimize."""

    baseline: ScenarioOut = Field(..., description="Constant-service-speed scenario.")
    optimized: ScenarioOut = Field(..., description="Fuel-minimizing scenario.")
    saving_pct: float = Field(..., description="Fuel saved, percent of baseline.")
    co2_saved_t: float = Field(..., description="CO2 saved, in metric tons.")
    distance_nm: float = Field(..., description="Total voyage distance, in nm.")
