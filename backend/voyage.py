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

from fuel_model import daily_fuel


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


def leg_fuel(speed_kn, leg, c=0.0145):
    """Fuel burned on one leg at a steady speed, in metric tons.

    Reuses the calm-water cubic daily burn from `fuel_model.daily_fuel` and
    scales it by (a) the number of days spent on the leg and (b) the leg's
    weather penalty.

    Args:
        speed_kn: ship speed through the water on this leg, in knots.
        leg: the Leg being sailed.
        c: vessel-specific coefficient (tons/day per knot^3).

    Returns:
        Fuel consumption for the leg, in metric tons.
    """
    days = (leg.distance_nm / speed_kn) / 24
    return leg.weather * daily_fuel(speed_kn, c) * days


def leg_time(speed_kn, leg):
    """Time to sail one leg, in hours.

    Args:
        speed_kn: ship speed through the water on this leg, in knots.
        leg: the Leg being sailed.

    Returns:
        Sailing time for the leg, in hours (distance / speed).
    """
    return leg.distance_nm / speed_kn
