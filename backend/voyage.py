"""Voyage as a chain of legs, each with its own weather.

A real voyage is not one uniform stretch of water. It is a sequence of legs,
and each leg can have different weather. Bad weather (head winds, waves)
increases drag, so it burns more fuel for the same speed. We model this with a
simple multiplicative `weather` factor on top of the calm-water cubic burn:

    1.0  = calm water (no penalty)
    >1.0 = rougher water (e.g. 1.4 = +40% fuel for that leg)

Splitting the voyage into legs lets the optimizer choose a *different* speed for
each leg — the key to the Phase 2 optimization.
"""

import math
from dataclasses import dataclass

from fuel_model import FC0_DEFAULT, daily_fuel_loglinear


@dataclass
class Leg:
    """One segment of a voyage.

    Attributes:
        distance_nm: length of the leg, in nautical miles.
        weather: legacy weather factor (1.0 calm .. 1.6 storm). Mapped to a
            significant wave height (Hs) for the fuel model's wave term.
        beaufort: live Beaufort wind force number (0 calm). Drives the b2*B term.
        wind_angle_rad: pre-converted wind/heading angle for the fuel model's
            b4*cos(theta) term (see `wind_angle_rad_from`). Default 0.0 reproduces
            the calm/no-wind case.
    """

    distance_nm: float
    weather: float = 1.0
    beaufort: float = 0.0
    wind_angle_rad: float = 0.0


def weather_factor_to_wave_m(weather):
    """Approximate significant wave height (m) from our per-leg weather factor.

    F1 BRIDGE: the engine's environmental input is now wave height Hs, but the
    rest of the app still carries weather as a 1.0-1.6 fuel multiplier. We invert
    the band mapping used in weather.py (1.0 -> calm, 1.6 -> storm) so the
    existing per-leg weather still drives fuel — now through the formula's Hs
    term (b3) instead of a flat multiplier:

        factor 1.0 -> 0.0 m   (calm)
        factor 1.6 -> 5.0 m   (storm)

    This keeps the optimizer's weather-redistribution saving alive in F1 without
    yet wiring live Beaufort / wind angle (those arrive in later phases).
    """
    return max(0.0, (weather - 1.0) / 0.12)


def relative_wind_deg(wind_dir_deg, bearing_deg):
    """Relative angle (deg, 0..180) between the wind and the ship's heading.

    `wind_dir_deg` is the meteorological direction the wind blows FROM (Open-Meteo
    convention); `bearing_deg` is the ship's heading. The folded difference gives
    a relative angle where **0 = headwind** (wind blowing straight onto the bow)
    and **180 = following wind** (wind from astern).
    """
    alpha = abs(wind_dir_deg - bearing_deg) % 360.0
    if alpha > 180.0:
        alpha = 360.0 - alpha
    return alpha


def wind_angle_rad_from(wind_dir_deg, bearing_deg):
    """Convert (wind direction, heading) to the angle the fuel model expects.

    SIGN CONVENTION: the fuel model's wind term is `b4 * cos(angle)` with
    b4 = -0.048 (negative). We want a **headwind to increase** fuel and a
    **following wind to decrease** it. We map the relative angle so that:

        headwind   (relative 0)   -> angle = pi  -> cos = -1 -> b4*cos = +0.048  (more fuel)
        beam wind  (relative 90)  -> angle = pi/2 -> cos = 0  -> 0                (neutral)
        following  (relative 180) -> angle = 0    -> cos = +1 -> b4*cos = -0.048  (less fuel)

    i.e. angle = pi - radians(relative). With no wind data the caller passes the
    default 0.0, which reproduces the calm baseline (b4*cos(0) = -0.048).
    """
    rel = relative_wind_deg(wind_dir_deg, bearing_deg)
    return math.pi - math.radians(rel)


def leg_fuel(speed_kn, leg, draft_m=12.0, load=0.5, days_since_dd=180.0, fc0=FC0_DEFAULT):
    """Fuel burned on one leg at a steady speed, in metric tons.

    Uses the log-linear daily burn (`fuel_model.daily_fuel_loglinear`) scaled by
    the number of days at sea. The leg's weather factor maps to a wave height
    (Hs, b3 term); its live Beaufort number drives the b2 term; and its wind/
    heading angle drives the b4*cos(theta) term (headwind costs more, following
    wind less — see `wind_angle_rad_from`).

    Args:
        speed_kn: ship speed through the water on this leg, in knots.
        leg: the Leg being sailed (carries weather, beaufort, wind_angle_rad).
        draft_m: mean draft Dm, in metres (vessel input).
        load: load/ballast state, 0 (ballast) to 1 (fully laden).
        days_since_dd: days since last drydock (hull-fouling proxy).
        fc0: calm-water daily fuel at the reference speed for the vessel.

    Returns:
        Fuel consumption for the leg, in metric tons.
    """
    wave_m = weather_factor_to_wave_m(leg.weather)
    days = (leg.distance_nm / speed_kn) / 24
    daily = daily_fuel_loglinear(
        speed_kn,
        beaufort=leg.beaufort,
        wave_m=wave_m,
        draft_m=draft_m,
        load=load,
        wind_angle_rad=leg.wind_angle_rad,
        days_since_dd=days_since_dd,
        fc0=fc0,
    )
    return daily * days


def leg_time(speed_kn, leg):
    """Time to sail one leg, in hours.

    Args:
        speed_kn: ship speed through the water on this leg, in knots.
        leg: the Leg being sailed.

    Returns:
        Sailing time for the leg, in hours (distance / speed).
    """
    return leg.distance_nm / speed_kn
