"""Phase 2 check: baseline vs optimized speed profile for a 3-leg voyage.

The middle leg is a storm (weather 1.4). We compare sailing at constant service
speed (and idling at anchor until the berth ETA) against the fuel-minimizing
speed profile that arrives exactly on time.
"""

from voyage import Leg
from optimizer import baseline_voyage, optimize_speed_profile

CO2_PER_TON_FUEL = 3.11  # metric tons CO2 per metric ton of fuel burned


def main():
    legs = [Leg(700, 1.0), Leg(700, 1.4), Leg(700, 1.0)]  # middle leg = storm
    service_speed = 14.0
    berth_eta_h = 175.0

    base = baseline_voyage(legs, service_speed)
    idle_wait_h = berth_eta_h - base["total_time_h"]

    opt = optimize_speed_profile(legs, berth_eta_h)

    saving_t = base["total_fuel"] - opt["total_fuel"]
    saving_pct = saving_t / base["total_fuel"] * 100
    co2_saved = saving_t * CO2_PER_TON_FUEL

    print("=== Voyage: 3 legs x 700 nm (middle leg storm, weather 1.4) ===")
    print(f"Service speed: {service_speed} kn   |   Berth ETA: {berth_eta_h} h\n")

    print("BASELINE (constant service speed, then idle at anchor):")
    print(f"  total fuel    : {base['total_fuel']:.2f} t")
    print(f"  total time    : {base['total_time_h']:.2f} h")
    print(f"  idle wait     : {idle_wait_h:.2f} h at anchor\n")

    print("OPTIMIZED (per-leg speed profile, arrive on time):")
    speeds_str = ", ".join(f"{s:.2f}" for s in opt["speeds"])
    print(f"  per-leg speeds: [{speeds_str}] kn")
    print(f"  total fuel    : {opt['total_fuel']:.2f} t")
    print(f"  total time    : {opt['total_time_h']:.2f} h\n")

    print("RESULT:")
    print(f"  fuel saved    : {saving_t:.2f} t  ({saving_pct:.1f}%)")
    print(f"  CO2 saved     : {co2_saved:.2f} t  (1 t fuel = {CO2_PER_TON_FUEL} t CO2)")


if __name__ == "__main__":
    main()
