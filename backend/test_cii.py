"""Phase 3 check: full chain — optimize a voyage, then grade it on CII.

Ties Phases 2 and 3 together: build a 3-leg voyage (storm in the middle), run
both the baseline and the optimized speed profile, then grade each on the IMO
CII A-E scale to show the carbon grade jump from optimization.
"""

from voyage import Leg
from optimizer import baseline_voyage, optimize_speed_profile
from cii import rate_voyage, required_cii


def main():
    legs = [Leg(700, 1.0), Leg(700, 1.4), Leg(700, 1.0)]
    dwt = 40000
    year = 2026
    service_speed = 14.0
    berth_eta_h = 175.0
    distance = sum(leg.distance_nm for leg in legs)

    base = baseline_voyage(legs, service_speed)
    opt = optimize_speed_profile(legs, berth_eta_h)

    rows = [
        ("baseline", base["total_fuel"]),
        ("optimized", opt["total_fuel"]),
    ]

    print(f"=== CII rating: dwt={dwt}, year={year}, distance={distance} nm ===\n")

    header = f"{'scenario':>10} | {'fuel (t)':>9} | {'attained CII':>13} | {'ratio':>6} | {'grade':>5}"
    print(header)
    print("-" * len(header))

    results = {}
    for name, fuel in rows:
        r = rate_voyage(fuel, dwt, distance, year)
        results[name] = r
        print(
            f"{name:>10} | {fuel:>9.2f} | {r['attained']:>13.3f} | {r['ratio']:>6.3f} | {r['grade']:>5}"
        )

    req = required_cii(dwt, year)
    print(f"\nrequired CII ({year}): {req:.3f} g CO2 / (dwt*nm)")
    print(
        f"HEADLINE: grade jump {results['baseline']['grade']} -> "
        f"{results['optimized']['grade']} (baseline -> optimized)"
    )


if __name__ == "__main__":
    main()
