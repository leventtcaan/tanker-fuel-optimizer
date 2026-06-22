# Engine Audit — PRUVA Tanker Fuel Optimizer

Date: 2026-06-23. Scope: the backend physics/optimizer/CII/economics/zones/routing
engine. Method: read every module, then check each claim empirically against
published IMO values and known real-world numbers. Assumption going in: nothing
is correct until verified.

**Headline:** No formula or unit BUGS were found. Constants match the published
IMO MEPC values, the physics is internally consistent, and real-route distances
and fuel figures pass a smell test. There are several deliberate APPROXIMATIONS
and a few debatable design choices, all listed below so the prototype can be
trusted for what it is — an illustrative decision-support demo, not a certified
compliance tool.

---

## SOLID (verified correct)

### Fuel model (`fuel_model.py`, `voyage.py`)
- **Cubic power law applied correctly.** `daily_fuel = c·V³`. Verified V² voyage
  scaling: `voyage_fuel(14)/voyage_fuel(12) = 1.3611` exactly equals `(14/12)² =
  1.3611`. The algebra `c·V³·(d/V/24) = c·V²·d/24` is right.
- **Coefficient `c = 0.0145` is realistic for a mid-size tanker.** Daily burn:
  10 kn → 14.5, 12 → 25.1, 14 → 39.8, 16 → 59.4, 18 → 84.6 t/day. Cruising-speed
  values (12–16 kn) land in the ~25–60 t/day band, consistent with the stated
  ~30–70 t/day for a mid-size (MR/Aframax) tanker. **Not** off by an order of
  magnitude. Cross-check: İstanbul→Singapore at 14 kn = 694 t over ~418 h ≈
  40 t/day, matching `daily_fuel(14)`.

### Optimizer (`optimizer.py`)
- **Speed bounds respected** in every case tested (all speeds stayed within
  [10, 16] kn).
- **JIT time constraint respected** for all feasible ETAs (arrival ≤ deadline).
- **Sane edge behavior:**
  - Tight ETA (140 h on a 131.25 h-minimum voyage): redistributes correctly —
    storm leg slower (13.94 kn) than calm legs (15.59 kn).
  - Loose ETA (630 h, 5000 h): floors all legs to `vmin` = 10 kn and stops there
    (won't sail slower than the bound), arriving early. Correct.

### CII (`cii.py`) — all constants match published IMO MEPC values
- `CF = 3.114` t CO₂/t fuel (HFO). ✔
- Tanker reference line `a = 5247`, `c = 0.610` (MEPC.353(78)). ✔
- Reduction factors `Z`: 2023=0.05, 2024=0.07, 2025=0.09, 2026=0.11 (MEPC). ✔
- Tanker rating boundaries `d1..d4 = 0.86, 0.94, 1.06, 1.18` (MEPC.354(78)). ✔
- **Units consistent:** attained CII for 1 t fuel / (1 dwt · 1 nm) = 3,114,000 g,
  i.e. g CO₂ / (dwt·nm). ✔

### Economics (`economics.py`)
- **Blended ECA cost math is correct.** 100 t split 50/50 →
  50·737 + 50·586 = $66,150, matches.
- **Reference prices are realistic** (2024–25 ranges): VLSFO $586/t, LSMGO
  $737/t, HSFO $435/t; EU ETS €85/tCO₂. Reasonable as editable reference values.

### Routing (`routing.py`) — distances and coordinate handling correct
- İstanbul→Singapore = 5,858 nm (expected 5,800–6,100). ✔
- Rotterdam→Singapore = 8,368 nm (plausible, ~8,000–8,600). ✔
- Gibraltar→İzmir = 1,646 nm (expected 1,400–1,800). ✔
- **[lon,lat] ↔ [lat,lon] handling is correct everywhere**: searoute is fed
  [lon,lat]; output is converted back to [lat,lon]; first route coordinate of
  each route matches its origin port within rounding.

### Zones (`zones.py`) — boxes are in the right places
- Med center, Gibraltar, Aegean/İzmir, North Sea, Baltic all correctly inside;
  open Atlantic, Red Sea, and inland points correctly outside.

---

## APPROXIMATE (intentional, acceptable for a prototype)

1. **Single fuel coefficient `c` for one vessel class.** The model is one generic
   mid-size tanker. Absolute fuel/grades shift with `c`; fine for relative
   "baseline vs optimized" comparison, which is the product's point.
2. **Weather as a fuel-only multiplier.** `weather > 1.0` raises fuel at the same
   speed-through-water; it does not also model involuntary speed loss or added
   time. A coarse but standard first-order proxy.
3. **ECA split by distance share, not per-leg fuel.** `blended_fuel_cost_usd`
   prorates total fuel by ECA distance fraction. Since fuel/nm is ~constant at a
   given speed this is close; a stormy ECA leg burns slightly more than its
   distance share implies.
4. **One carbon factor (HFO 3.114) for all fuel.** ECA legs really burn MGO
   (CF ≈ 3.206), so CO₂ — and thus CII and ETS — are understated by ~3% on the
   ECA fraction only. Small and disclosed.
5. **ECA zones are bounding boxes, not IMO polygons** (already disclosed in
   `zones.py`). Good enough to attribute sea distance, not a navigational
   boundary.
6. **Speed is through-water; no currents/leeway.** Standard simplification.
7. **CII applied per-voyage, not annual** (disclosed in `cii.py`). Note the
   consequence: at constant speed the attained CII is *independent of route
   length* (it is an intensity) — İstanbul→Singapore and Gibraltar→İzmir both
   give CII 9.22 / grade E at 14 kn. This is mathematically correct for an
   intensity metric, just worth knowing so the constant grade isn't surprising.

---

## BUGS (clear formula/unit errors)

**None found.** Every constant checked against published IMO values matched, unit
analysis is consistent, and the optimizer respects its bounds and constraint. No
code changes were required.

---

## LIMITATIONS (disclose honestly — not fixed; would change behavior)

1. **[FIXED] No infeasibility guard in the optimizer.** If `berth_eta_h` is below the
   minimum possible time (all legs at `vmax`), SLSQP returns the all-`vmax`
   profile that *silently violates* the deadline (e.g. ETA 100 h on a 131.25 h
   voyage → returns 131.2 h, no warning). The UI's wide ETA slider (50–800 h)
   makes this reachable for long routes. Recommendation: detect
   `min_time > berth_eta_h` and surface a "deadline not achievable" warning.
   RESOLVED: `optimize_speed_profile` now returns `feasible` + `min_time_h`; when
   infeasible it returns the all-vmax profile flagged `feasible=False`, surfaced
   to the API and shown as a red warning banner in the UI.
2. **Money saved counts fuel only, not carbon.** `money_saved_usd = baseline fuel
   cost − optimized fuel cost` (USD). ETS cost (EUR) is computed and displayed but
   excluded from the headline saving, and the two currencies are never mixed.
   Intentional, but the "Para Tasarrufu" figure understates total economic benefit
   when EU ETS applies.
3. **`blended_fuel_cost_usd` ignores the user's `fuel_type` for routed voyages.**
   It hard-codes ECA=LSMGO and open-sea=VLSFO. Defensible (ECAs mandate
   low-sulphur fuel), but a user who selects HSFO still gets VLSFO/LSMGO pricing
   on a routed voyage. Custom *prices* are respected; the *grade choice* is not.
4. **Black Sea over-coverage.** The Mediterranean ECA box (30–46 N, −6 to 36.5 E)
   spills into the Black Sea (e.g. 44 N, 34 E reads as ECA, which it is not).
   No current port/route crosses it, so it is latent, but a Black Sea route would
   be mis-priced as ECA. Tightening the box risks under-covering the eastern Med,
   so left as-is and flagged.
5. **`required_cii` year fallback picks the strictest factor for *any* unknown
   year**, including past years (e.g. 2020 would wrongly get the 2026 11%
   reduction). Not reachable from the UI (year selector is 2023–2026), and
   post-2026 IMO factors are not yet published, so 2026's is a reasonable
   placeholder — but the pre-2023 behavior is technically wrong.
6. **EU scope fraction is a manual input, not derived.** Honest by design (the
   docstring explains the 40/70/100% phase-in), but it means ETS cost is only as
   right as the operator's entered fraction.

---

## Bottom line

The engine is trustworthy as an **illustrative optimization demo**: the physics
and the IMO regulatory constants are correct, real distances check out, and the
relative savings story (slow steaming + weather redistribution → lower fuel, cost,
and CII grade) is sound. It is **not** a certified compliance calculator — the
absolute grades depend on a single generic vessel coefficient, CII is per-voyage,
and the limitations above (especially #1, the missing infeasibility guard) should
be addressed before anyone treats an output as authoritative.
