"""Speed-profile optimizer: least fuel while still arriving on time.

Two independent sources of fuel saving are captured here:

1. JIT (Just-In-Time) slack.
   If the berth is only free at a fixed ETA, racing there at service speed and
   then idling at anchor wastes fuel. Because voyage fuel scales with speed
   squared (see fuel_model), spreading the *same* distance over the *whole*
   available time at a slower, steadier speed burns less fuel for the exact
   same arrival moment. The waiting time becomes sailing time.

2. Weather redistribution.
   Burning fuel in a storm (weather > 1.0) is expensive. The optimizer shifts
   speed *away* from the rough leg and *into* the calm legs: go slower where
   each knot costs the most fuel, faster where it is cheap. The total time
   budget is preserved, but the fuel bill drops.

The optimizer below combines both: it minimizes total fuel subject to a single
"arrive by deadline" time constraint, choosing one speed per leg.
"""

import numpy as np
from scipy.optimize import minimize

from voyage import leg_fuel, leg_time


def baseline_voyage(legs, service_speed_kn, c=0.0145):
    """Sail every leg at one constant service speed (the naive plan).

    Args:
        legs: list of Leg objects.
        service_speed_kn: the single speed used for all legs, in knots.
        c: vessel-specific coefficient (tons/day per knot^3).

    Returns:
        dict with:
            total_fuel:   total fuel for the voyage, in metric tons.
            total_time_h: total sailing time, in hours.
    """
    total_fuel = sum(leg_fuel(service_speed_kn, leg, c) for leg in legs)
    total_time_h = sum(leg_time(service_speed_kn, leg) for leg in legs)
    return {"total_fuel": total_fuel, "total_time_h": total_time_h}


def optimize_speed_profile(legs, berth_eta_h, vmin=10.0, vmax=16.0, c=0.0145):
    """Find the per-leg speeds that minimize fuel and still arrive by deadline.

    Minimizes total fuel over all legs using SLSQP, with each leg's speed bounded
    to [vmin, vmax] and a single inequality constraint that total sailing time
    does not exceed the berth ETA (arrive on time, not early).

    The starting guess is the constant speed that exactly fills the time budget,
    so the optimizer begins from a feasible "use all the time" point and then
    redistributes speed across legs to exploit the weather differences.

    Args:
        legs: list of Leg objects.
        berth_eta_h: time budget — the ship must arrive within this many hours.
        vmin: minimum allowed speed per leg, in knots.
        vmax: maximum allowed speed per leg, in knots.
        c: vessel-specific coefficient (tons/day per knot^3).

    Returns:
        dict with:
            speeds:       list of optimized speeds, one per leg, in knots.
            total_fuel:   total fuel at the optimized profile, in metric tons.
            total_time_h: total sailing time at the optimized profile, in hours.
            min_time_h:   fastest possible time (all legs at vmax), in hours.
            feasible:     False if berth_eta_h is below min_time_h (deadline
                          unreachable even at full speed); True otherwise.
    """
    total_distance = sum(leg.distance_nm for leg in legs)

    def total_fuel(speeds):
        return sum(leg_fuel(s, leg, c) for s, leg in zip(speeds, legs))

    # Fastest possible voyage: every leg at vmax. If even this overshoots the
    # deadline, no speed profile can arrive on time -> the request is infeasible.
    min_time_h = sum(leg_time(vmax, leg) for leg in legs)
    if berth_eta_h < min_time_h:
        # Return the fastest (all-vmax) profile but flag it as not on time.
        fastest = [vmax] * len(legs)
        return {
            "speeds": fastest,
            "total_fuel": total_fuel(fastest),
            "total_time_h": min_time_h,
            "min_time_h": min_time_h,
            "feasible": False,
        }

    # x0: the single constant speed that uses up exactly the whole time budget.
    x0_speed = total_distance / berth_eta_h
    x0_speed = min(max(x0_speed, vmin), vmax)
    x0 = np.full(len(legs), x0_speed)

    def time_slack(speeds):
        # >= 0 means we arrive on or before the deadline.
        used = sum(leg_time(s, leg) for s, leg in zip(speeds, legs))
        return berth_eta_h - used

    bounds = [(vmin, vmax)] * len(legs)
    constraints = [{"type": "ineq", "fun": time_slack}]

    result = minimize(
        total_fuel,
        x0,
        method="SLSQP",
        bounds=bounds,
        constraints=constraints,
    )

    speeds = list(result.x)
    return {
        "speeds": speeds,
        "total_fuel": total_fuel(speeds),
        "total_time_h": sum(leg_time(s, leg) for s, leg in zip(speeds, legs)),
        "min_time_h": min_time_h,
        "feasible": True,
    }
