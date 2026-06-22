"""CII module — turn voyage fuel into an IMO Carbon Intensity Indicator grade.

The IMO Carbon Intensity Indicator (CII) measures how much CO2 a ship emits to
move one ton of deadweight one nautical mile. Lower is better. Each year a ship
gets a letter grade A (best) to E (worst) by comparing its *attained* CII to a
*required* CII derived from a tanker reference line that tightens every year.

All constants below are the real IMO values for tankers:
  - CF (HFO carbon factor) from MEPC guidelines.
  - Reference line a*dwt^(-c) from MEPC.353(78).
  - Annual reduction factors Z from the MEPC reduction schedule.
  - A-E boundary vectors (d1..d4) from MEPC.354(78).

NOTE: Real CII is an ANNUAL figure — the sum of all voyages over a calendar
year divided by the year's total transport work. Here we apply the identical
formula at the single-voyage level purely for illustration, so we can compare a
baseline voyage against an optimized one on the same A-E scale.
"""

CF = 3.114                      # tons CO2 per ton fuel (HFO)

# IMO tanker reference line (MEPC.353(78)):  ref = a * dwt**(-c)
REF_A, REF_C = 5247, 0.610

# Annual reduction (Z) factors by year (MEPC):
Z_FACTORS = {2023: 0.05, 2024: 0.07, 2025: 0.09, 2026: 0.11}

# Tanker rating boundary vectors (MEPC.354(78)):
D1, D2, D3, D4 = 0.86, 0.94, 1.06, 1.18


def attained_cii(total_fuel_t, dwt, distance_nm, cf=CF):
    """Attained CII for a voyage, in grams CO2 per (dwt * nautical mile).

    Converts fuel burned into CO2 emitted (via the carbon factor) and divides by
    the transport work done (deadweight times distance). This is the ship's
    actual carbon intensity.

    Args:
        total_fuel_t: total fuel burned, in metric tons.
        dwt: deadweight tonnage of the vessel.
        distance_nm: distance sailed, in nautical miles.
        cf: carbon factor (tons CO2 per ton fuel). Defaults to HFO's 3.114.

    Returns:
        Attained CII in g CO2 / (dwt * nm).
    """
    co2_grams = total_fuel_t * cf * 1_000_000
    return co2_grams / (dwt * distance_nm)


def required_cii(dwt, year):
    """Required CII for a given vessel size and year.

    Starts from the IMO tanker reference line (a * dwt^-c) and tightens it by
    the year's reduction factor Z. Larger ships have a lower reference intensity,
    and the requirement gets stricter every year. Unknown years fall back to the
    strictest (largest) reduction available.

    Args:
        dwt: deadweight tonnage of the vessel.
        year: calendar year of the rating.

    Returns:
        Required CII in g CO2 / (dwt * nm).
    """
    ref = REF_A * dwt ** (-REF_C)
    z = Z_FACTORS.get(year, max(Z_FACTORS.values()))
    return ref * (1 - z)


def cii_grade(attained, required):
    """Map an attained/required CII ratio to an A-E grade.

    The ratio is the attained CII divided by the required CII (below 1.0 means
    cleaner than required). It is bucketed by the IMO tanker boundary vectors
    d1..d4:

        ratio <  d1            -> "A"  (well below requirement)
        d1 <= ratio <  d2      -> "B"
        d2 <= ratio <  d3      -> "C"  (around requirement)
        d3 <= ratio <  d4      -> "D"
        ratio >= d4            -> "E"  (well above requirement)

    Args:
        attained: attained CII.
        required: required CII.

    Returns:
        Tuple of (grade letter, ratio).
    """
    ratio = attained / required
    if ratio < D1:
        grade = "A"
    elif ratio < D2:
        grade = "B"
    elif ratio < D3:
        grade = "C"
    elif ratio < D4:
        grade = "D"
    else:
        grade = "E"
    return grade, ratio


def rate_voyage(total_fuel_t, dwt, distance_nm, year):
    """Rate a single voyage end-to-end: attained, required, ratio, grade.

    Convenience wrapper that runs the full CII pipeline for one voyage and
    bundles the results.

    Args:
        total_fuel_t: total fuel burned on the voyage, in metric tons.
        dwt: deadweight tonnage of the vessel.
        distance_nm: distance sailed, in nautical miles.
        year: calendar year of the rating.

    Returns:
        dict with keys: attained, required, ratio, grade.
    """
    attained = attained_cii(total_fuel_t, dwt, distance_nm)
    required = required_cii(dwt, year)
    grade, ratio = cii_grade(attained, required)
    return {
        "attained": attained,
        "required": required,
        "ratio": ratio,
        "grade": grade,
    }
