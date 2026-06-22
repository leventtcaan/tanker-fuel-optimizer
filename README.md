# Tanker Fuel Optimizer

A small tool to model and optimize tanker fuel consumption as a function of
sailing speed.

The core idea is the **cubic power law**: a ship's required engine power (and
therefore its daily fuel burn) scales with the cube of speed, because hull drag
grows with speed squared and power equals drag times speed. Over a *fixed*
voyage distance, total fuel scales with speed squared — which is why "slow
steaming" saves real money.

## Status

- **Phase 1 — done:** backend fuel model (`backend/fuel_model.py`) + a fuel
  table check (`backend/test_fuel.py`).

## Run the check

```bash
cd backend
python3 test_fuel.py
```

This prints daily fuel, voyage days, voyage fuel, and % savings versus a 14 kn
baseline over a 2000 nm voyage.
