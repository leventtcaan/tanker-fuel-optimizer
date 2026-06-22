"""Fuel model for a tanker — the cubic power law.

The physics in plain words
--------------------------
A ship pushing through water mostly fights *residual / wave-making drag*.
The hull drag force grows roughly with the square of speed (F ~ V^2),
because drag depends on dynamic pressure (~ V^2). Power is force times
speed (P = F * V), so:

    P ~ V^2 * V = V^3

That is why **engine power, and therefore fuel burned per day, scales with
speed cubed**: go a bit faster and the daily fuel bill explodes.

Voyage fuel over a *fixed* distance behaves differently. The time spent at
sea is shorter when you go faster (time = distance / speed), so the V^3
daily burn gets divided by one factor of V:

    voyage_fuel = daily_fuel * time
                ~ V^3 * (distance / V)
                ~ V^2 * distance

So for a fixed route, **total fuel scales with speed squared** — still a
strong penalty for speeding, but one power less than the daily figure.
This is the core idea behind "slow steaming" to save fuel.
"""


def daily_fuel(speed_kn, c=0.0145):
    """Fuel burned per day at a steady speed, in metric tons/day.

    Uses the cubic power law: fuel per day ~ speed^3, because required
    engine power scales with the cube of speed (drag ~ V^2, power = drag * V).

    Args:
        speed_kn: ship speed through the water, in knots.
        c: vessel-specific coefficient (tons/day per knot^3). The default
           0.0145 is a rough mid-size tanker figure (~59 t/day at 16 kn).

    Returns:
        Fuel consumption in metric tons per day.
    """
    return c * speed_kn ** 3


def voyage_fuel(speed_kn, distance_nm, c=0.0145):
    """Total fuel for a voyage over a fixed distance, in metric tons.

    Over a fixed distance the daily cubic burn is spread over fewer days at
    higher speed (days = distance / speed / 24), so total voyage fuel scales
    with speed *squared* rather than cubed. Slower = cheaper.

    Args:
        speed_kn: ship speed through the water, in knots.
        distance_nm: voyage distance, in nautical miles.
        c: vessel-specific coefficient (tons/day per knot^3).

    Returns:
        Total fuel consumption for the voyage, in metric tons.
    """
    days = (distance_nm / speed_kn) / 24
    return daily_fuel(speed_kn, c) * days
