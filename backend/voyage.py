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

from dataclasses import dataclass

from fuel_model import FC0_DEFAULT, daily_fuel_loglinear


@dataclass
class Leg:
    """One segment of a voyage.

    Attributes:
        distance_nm: length of the leg, in nautical miles.
        weather: multiplicative fuel penalty. 1.0 is calm water; values above
            1.0 mean rougher conditions that burn more fuel at a given speed.
    """

    distance_nm: float
    weather: float = 1.0


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


def leg_fuel(speed_kn, leg, draft_m=12.0, load=0.5, days_since_dd=180.0, fc0=FC0_DEFAULT):
    """Fuel burned on one leg at a steady speed, in metric tons.

    Uses the log-linear daily burn (`fuel_model.daily_fuel_loglinear`) scaled by
    the number of days spent on the leg. The leg's weather factor is mapped to a
    significant wave height (Hs) and fed into the formula's wave term. Beaufort
    and wind angle stay at their calm defaults in F1.

    Args:
        speed_kn: ship speed through the water on this leg, in knots.
        leg: the Leg being sailed.
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
        wave_m=wave_m,
        draft_m=draft_m,
        load=load,
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
