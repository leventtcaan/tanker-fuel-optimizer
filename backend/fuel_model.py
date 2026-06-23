"""Fuel model for a tanker.

The engine fuel function is the **log-linear (Admiralty-extended) model** in
`daily_fuel_loglinear` / `voyage_fuel_loglinear` below. The original cubic power
law (`daily_fuel` / `voyage_fuel`) is kept as a DEPRECATED reference (still used
by the legacy fuel table in test_fuel.py) but is no longer wired into the
optimizer.

The cubic power law (deprecated)
--------------------------------
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


import math


def daily_fuel(speed_kn, c=0.0145):
    """DEPRECATED (use daily_fuel_loglinear): cubic daily fuel, in metric tons/day.

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
    """DEPRECATED (use voyage_fuel_loglinear): cubic voyage fuel, in metric tons.

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


# ---------------------------------------------------------------------------
# Log-linear ("Admiralty-extended") daily fuel model — the ENGINE fuel function
# ---------------------------------------------------------------------------
#
# Instead of the pure cubic above, daily fuel is modelled as a log-linear
# function of speed plus additive environmental and vessel terms. Taking logs of
# the classic Admiralty relation and adding correction terms gives:
#
#   ln(FC) = ln(FC0) + b1*ln(V/Vref)
#                    + b2*B + b3*Hs + b4*cos(theta)
#                    + b5*(Dm - 10) + bL*load + b7*(d_DD - 180)
#
# i.e. multiplicatively:
#
#   FC = FC0 * (V/Vref)^b1 * exp( b2*B + b3*Hs + b4*cos(theta)
#                                 + b5*(Dm-10) + bL*load + b7*(d_DD-180) )
#
# Each term: V = speed through water; B = Beaufort number; Hs = significant wave
# height (m); theta = wind/sea angle relative to heading; Dm = mean draft (m);
# load = load/ballast state (0 ballast .. 1 fully laden); d_DD = days since last
# drydock (a hull-fouling proxy).
#
# The coefficients are LITERATURE / slide-based, not fitted by us (see
# _reference/screens/formula.png): Holtrop-Mennen (V^a resistance), Kwon
# (Beaufort/wave added resistance), Schneekluth (draft), Schultz (hull fouling),
# plus ITTC / IMO MEPC ranges. They sit inside the published bands on the slide.
VREF_KN = 12.0          # reference speed the model is normalised around
B1_SPEED = 2.85         # exponent on speed ratio (slide band 2.5-3.5)
B2_BEAUFORT = 0.082     # per Beaufort number (band 0.03-0.12)
B3_WAVE = 0.055         # per metre of significant wave height (band 0.03-0.08)
B4_WIND_ANGLE = -0.048  # per cos(theta) of wind/sea angle vs heading
B5_DRAFT = 0.031        # per metre of draft above the reference (band 0.02-0.06)
BL_LOAD = 0.17          # per unit load/ballast state
B7_FOULING = 0.00021    # per day since drydock above the reference (band 1e-4..3e-4)
DRAFT_REF_M = 10.0      # draft the b5 term is measured against
FOULING_REF_DAYS = 180.0  # drydock interval the b7 term is measured against

# Calm-water daily fuel at VREF for the reference vessel (~40k DWT mid-size
# tanker). Calibrated so that at Vref, calm (B=0, Hs=0, theta=0), reference draft
# (Dm=10), half load and reference fouling, daily burn lands in the realistic
# ~25-30 t/day band: FC0 * exp(BL_LOAD*0.5 + B4_WIND_ANGLE) = 26 * exp(0.037)
# = ~27 t/day.
FC0_DEFAULT = 26.0


def daily_fuel_loglinear(
    speed_kn,
    beaufort=0.0,
    wave_m=0.0,
    draft_m=12.0,
    load=0.5,
    wind_angle_rad=0.0,
    days_since_dd=180.0,
    fc0=FC0_DEFAULT,
    vref=VREF_KN,
):
    """Daily fuel (t/day) from the log-linear Admiralty-extended model.

    FC = FC0 * (V/Vref)^b1 * exp( b2*B + b3*Hs + b4*cos(theta)
                                  + b5*(Dm-10) + bL*load + b7*(d_DD-180) )

    Over a *fixed distance* this makes voyage fuel scale as V^(b1-1) ~ V^1.85,
    so it is still strictly increasing in speed — slow steaming still saves fuel
    and the optimizer keeps the same qualitative behaviour as the old cubic.

    Args:
        speed_kn: speed through the water, in knots.
        beaufort: Beaufort wind force number (0 calm). F1 keeps this 0.
        wave_m: significant wave height Hs, in metres (0 calm).
        draft_m: mean draft Dm, in metres.
        load: load/ballast state, 0 (ballast) to 1 (fully laden).
        wind_angle_rad: wind/sea angle relative to heading, in radians. F1 = 0.
        days_since_dd: days since last drydock (hull-fouling proxy).
        fc0: calm-water daily fuel at the reference speed for the vessel.
        vref: reference speed the model is normalised around, in knots.

    Returns:
        Fuel consumption in metric tons per day.
    """
    speed_term = (speed_kn / vref) ** B1_SPEED
    exponent = (
        B2_BEAUFORT * beaufort
        + B3_WAVE * wave_m
        + B4_WIND_ANGLE * math.cos(wind_angle_rad)
        + B5_DRAFT * (draft_m - DRAFT_REF_M)
        + BL_LOAD * load
        + B7_FOULING * (days_since_dd - FOULING_REF_DAYS)
    )
    return fc0 * speed_term * math.exp(exponent)


def voyage_fuel_loglinear(speed_kn, distance_nm, **kwargs):
    """Total log-linear fuel for a voyage over a fixed distance, in metric tons.

    Spreads the daily burn over the days at sea (days = distance / speed / 24).
    Extra keyword args (beaufort, wave_m, draft_m, load, ...) pass straight
    through to `daily_fuel_loglinear`.
    """
    days = (distance_nm / speed_kn) / 24
    return daily_fuel_loglinear(speed_kn, **kwargs) * days
