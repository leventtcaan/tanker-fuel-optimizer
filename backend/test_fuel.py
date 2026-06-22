"""Quick check of the fuel model: print a fuel table for a fixed voyage.

Compares speeds against a 14 kn baseline to show the savings from slowing
down (slow steaming) over a fixed distance.
"""

from fuel_model import daily_fuel, voyage_fuel

DISTANCE_NM = 2000
SPEEDS_KN = [16, 14, 12.6]
BASELINE_KN = 14


def main():
    baseline_fuel = voyage_fuel(BASELINE_KN, DISTANCE_NM)

    header = f"{'speed (kn)':>11} | {'daily fuel (t/d)':>16} | {'voyage days':>11} | {'voyage fuel (t)':>15} | {'% saving vs 14kn':>16}"
    print(f"Voyage distance: {DISTANCE_NM} nm   |   baseline: {BASELINE_KN} kn")
    print(header)
    print("-" * len(header))

    for speed in SPEEDS_KN:
        daily = daily_fuel(speed)
        days = (DISTANCE_NM / speed) / 24
        voyage = voyage_fuel(speed, DISTANCE_NM)
        saving_pct = (baseline_fuel - voyage) / baseline_fuel * 100
        print(
            f"{speed:>11.1f} | {daily:>16.2f} | {days:>11.2f} | {voyage:>15.2f} | {saving_pct:>15.1f}%"
        )


if __name__ == "__main__":
    main()
