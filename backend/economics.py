"""Economics layer: put a money figure on the fuel and CO2 results.

This sits on top of the physics/optimizer/CII engine — it does not change any of
it. It converts tons of fuel into USD fuel cost and tons of CO2 into EUR carbon
cost under the EU Emissions Trading System (ETS).

The prices below are EDITABLE REFERENCE values, not a live market feed. They are
deliberately named REFERENCE so nobody mistakes them for real-time quotes; the
API lets callers override them per request.
"""

# Reference bunker prices in USD per metric ton (editable, NOT live quotes).
PRICES_USD_PER_T = {
    "VLSFO": 586.0,  # Very Low Sulphur Fuel Oil (0.5% S)
    "LSMGO": 737.0,  # Low Sulphur Marine Gas Oil (0.1% S, used in ECAs)
    "HSFO": 435.0,   # High Sulphur Fuel Oil (needs a scrubber)
}

# Reference EU ETS allowance (EUA) price in EUR per ton of CO2 (editable).
ETS_EUR_PER_TCO2 = 85.0


def fuel_cost_usd(fuel_t, fuel_type="VLSFO", prices=PRICES_USD_PER_T):
    """Fuel cost of a voyage in USD.

    Args:
        fuel_t: fuel burned, in metric tons.
        fuel_type: bunker grade key into `prices` (e.g. "VLSFO").
        prices: mapping of fuel type -> USD per metric ton.

    Returns:
        Fuel cost in USD. Unknown fuel types fall back to the VLSFO price.
    """
    price = prices.get(fuel_type, prices.get("VLSFO", 0.0))
    return fuel_t * price


def ets_cost_eur(co2_t, eu_scope_fraction=0.0, ets_price=ETS_EUR_PER_TCO2):
    """EU ETS carbon cost of a voyage in EUR.

    Only emissions that fall inside the EU ETS scope are charged, so we multiply
    total CO2 by `eu_scope_fraction` (the share of this voyage's CO2 that is in
    scope) before applying the allowance price.

    Note on EU ETS phase-in: shipping pays for a growing share of its in-scope
    (EU-leg) emissions — 40% in 2024, 70% in 2025, 100% from 2026 onward. Rather
    than hardcode a year, we expose `eu_scope_fraction` as an input for honesty:
    the caller sets it from the route's EU exposure and the relevant year. A
    fully non-EU voyage (e.g. İstanbul -> Singapore) is out of scope -> 0.0.

    Args:
        co2_t: total CO2 emitted, in metric tons.
        eu_scope_fraction: share of CO2 inside EU ETS scope, 0.0 to 1.0.
        ets_price: EUA price in EUR per ton of CO2.

    Returns:
        Carbon cost in EUR.
    """
    return co2_t * eu_scope_fraction * ets_price
