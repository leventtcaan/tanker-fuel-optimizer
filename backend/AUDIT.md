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

## UPDATE — Phase F1: fuel model swapped to log-linear (2026-06-23)

The engine fuel function is no longer the cubic power law. It is now the teammates'
**log-linear (Admiralty-extended) model** (`fuel_model.daily_fuel_loglinear`):

    FC = FC0 · (V/Vref)^b1 · exp( b2·B + b3·Hs + b4·cos θ + b5·(Dm−10) + bL·load + b7·(d_DD−180) )

- Coefficients are LITERATURE / slide-based, not fitted here (see
  `_reference/screens/formula.png`): Vref=12, b1=2.85, b2=0.082, b3=0.055,
  b4=−0.048, b5=0.031, bL=0.17, b7=0.00021. They sit inside the slide's published
  bands (Holtrop-Mennen, Kwon, Schneekluth, Schultz, ITTC/IMO MEPC).
- FC0 calibrated to ~27 t/day at 12 kn calm (reference draft, half load) for a
  ~40k DWT mid-size tanker — within the realistic 25-30 t/day band.
- F1 scope: B=0, wind angle θ=0; Hs is derived from the existing per-leg weather
  factor (inverse of the weather.py band map) so weather redistribution survives;
  Dm (12 m), load (0.5), d_DD (180 d) are new optional inputs with defaults.
- Voyage fuel now scales as V^(b1−1) ≈ V^1.85 (was V² under cubic) — still strictly
  increasing in speed, so the optimizer and feasibility guard behave identically.
- **Re-baselined** (numbers shifted with the model, as expected): the 3-leg storm
  voyage went E→C (cubic) → now E→D at ~25% saving; İzmir→Singapore E→C → now
  E→D at ~19%. Test assertions updated accordingly; all tests green.
- The old cubic `daily_fuel` / `voyage_fuel` remain as DEPRECATED helpers (still
  exercised by the `test_fuel.py` table) but are no longer wired into the engine.

The verified-correct findings below describe the original cubic engine; they remain
accurate for that deprecated path and for the unchanged CII/economics/optimizer
structure (which consume fuel *tons* and are insulated from the model swap).

## UPDATE — Phase F2: live wind into the formula (2026-06-23)

The formula's Beaufort term (b2·B) and wind-angle term (b4·cos θ) are now driven
by LIVE wind, not F1 placeholders.

- `weather.py` now also fetches `wind_direction_10m` (with `wind_speed_10m`, in
  m/s) and derives a Beaufort number via `wind_ms_to_beaufort` (standard scale,
  0..12). On API timeout/error the leg falls back to B=0, wind_dir=None.
- `routing.leg_bearings` gives each resampled leg's heading; per leg we compute
  the relative wind angle (folded to 0..180, **0 = headwind, 180 = following**).
- SIGN CONVENTION (documented in `voyage.wind_angle_rad_from`): with b4 = -0.048,
  the angle is mapped so a **headwind increases** fuel (+0.048), a **following
  wind decreases** it (-0.048), beam wind is neutral, and no-wind reproduces the
  calm baseline. Verified empirically: at B=6, headwind 167 t > following 152 t >
  B=0 calm 93 t on a 700 nm leg at 14 kn.
- `legs_weather` now returns per-leg `{beaufort, wind_ms, wind_dir, bearing_deg,
  theta_deg, ...}`. Legacy explicit-`legs` and `auto_weather=False` paths are
  unaffected (B=0, angle=0 -> identical to F1).
- APPROXIMATION (disclosed): wind is sampled at ONE representative midpoint per
  leg, at the current time only (no along-leg or forecast-time variation) — same
  caveat as the wave sampling in limitation #7 below. Beaufort is bucketed from a
  point wind speed; theta uses the leg's straight-line heading, not the local
  along-track tangent. Optimizer/CII/economics structure unchanged.

## UPDATE — Phase F3: live ocean current + SOG model (2026-06-23)

Transit time is now driven by speed over ground (SOG), not speed through water
(STW), so ocean current changes effective time and therefore the optimizer's
fuel/time tradeoff ("against vs with the current").

- `weather.py` also fetches `ocean_current_velocity` (km/h -> knots) and
  `ocean_current_direction`; per-leg dict gains `current_kn` + `current_dir`.
  Fallback -> current_kn=0, current_dir=None.
- `voyage.py`: each `Leg` carries `current_along_kn` (signed: + following,
  - head). `current_along_kn(Vc, dir, bearing) = Vc·cos(bearing - dir)` projects
  the current onto the heading. `leg_sog(V, leg) = max(V + current_along, 2.0)`
  (V_MIN_SOG floor so SOG is never non-positive). `leg_time` now uses SOG.
- The optimizer is unchanged in shape: it minimises Σ leg_fuel (still on STW) and
  its JIT time constraint + `min_time_h` feasibility guard both go through
  `leg_time`, so they automatically use SOG. Verified: with a head current the
  min-time rises (131 -> 161 h at vmax), with a following current the optimizer
  can slow STW and burn less (163 t following < 209 t none < 260 t head on a
  fixed-ETA 3×700 nm voyage).
- `legs_weather` now also returns `current_kn`, `current_dir`, and the optimized
  `sog_kn`. No-current / `auto_weather=False` / legacy paths are byte-identical to
  F2 (current_along defaults to 0).
- APPROXIMATIONS (disclosed): SURFACE current only, sampled at ONE representative
  midpoint per leg, at the current time, and projected onto the leg's
  straight-line bearing (no along-track or forecast-time variation). Current
  affects time/SOG only — it is not separately added to the fuel formula.

## UPDATE — Phase F4: alternative routes with tradeoffs (2026-06-23)

`POST /alternatives` returns 2-4 candidate routes, each scored with the existing
engine (fuel/time/CII/ECA cost) + an HRA risk flag, with the lowest-fuel feasible
one flagged `recommended`. `/optimize` (single route) is unchanged.

- CAPABILITY PROBE (recorded in _reference/PLAN.md): searoute 1.6.0 **does**
  support real route `restrictions` (passages: babalmandab, bosporus, gibraltar,
  suez, panama, ormuz, northwest). İstanbul→Singapore default = 5861 nm via Suez
  (crosses HRA); restricting suez/babalmandab = 12574 nm via Cape (no HRA).
- Candidates: `shortest` (default lane); `hra_avoiding` (REAL passage-restricted
  lane, only when the shortest route crosses the HRA polygon from zones.geojson);
  `weather_current_optimized` (only with live data + a worst wave/head-current
  leg).
- APPROXIMATION (disclosed): `weather_current_optimized` is a WAYPOINT-NUDGE — it
  offsets the worst leg's midpoint ~1.5° perpendicular to its heading and stitches
  two real searoute legs (origin→wp→dest). It is NOT true weather-graph routing,
  and is only offered when it deviates >2% from the shortest lane and a worst leg
  actually stands out; in calm seas it is honestly omitted (no faked line).
- Scoring reuses `_legs_and_weather` (same auto-weather leg-building as /optimize)
  + `baseline_voyage`/`optimize_speed_profile`/`rate_voyage`/`blended_fuel_cost_usd`;
  CII/economics/optimizer untouched.

---

## SOLID (verified correct)

### Fuel model (`fuel_model.py`, `voyage.py`) — original cubic (now deprecated)
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
4. **Black Sea over-coverage (COST split only).** The Mediterranean ECA box
   (30–46 N, −6 to 36.5 E) used by `zones.py` for the cost split spills into the
   Black Sea (e.g. 44 N, 34 E reads as ECA, which it is not). No current
   port/route crosses it, so it is latent. NOTE: the MAP now draws polygon-
   accurate zones from data/zones.geojson (Phase C), so the *display* no longer
   over-covers; only the bbox-based costing retains this simplification.
5. **`required_cii` year fallback picks the strictest factor for *any* unknown
   year**, including past years (e.g. 2020 would wrongly get the 2026 11%
   reduction). Not reachable from the UI (year selector is 2023–2026), and
   post-2026 IMO factors are not yet published, so 2026's is a reasonable
   placeholder — but the pre-2023 behavior is technically wrong.
6. **EU scope fraction is a manual input, not derived.** Honest by design (the
   docstring explains the 40/70/100% phase-in), but it means ETS cost is only as
   right as the operator's entered fraction.
7. **Wave-height -> weather-factor mapping is a simplified band heuristic**
   (`weather.py`). Live significant wave height from Open-Meteo Marine is mapped
   to a fuel factor in [1.0, 1.6] via fixed bands (<1 m→1.0 … >5 m→1.6). Real
   added wave resistance depends on hull form, heading relative to the swell, and
   speed; this transparent band model is a stand-in, not a seakeeping
   calculation. Weather is sampled at ONE representative midpoint per leg and at
   the current time only (no along-leg or forecast-time variation). On API
   timeout/error a leg falls back to a calm 1.0 factor.

---

## Bottom line

The engine is trustworthy as an **illustrative optimization demo**: the physics
and the IMO regulatory constants are correct, real distances check out, and the
relative savings story (slow steaming + weather redistribution → lower fuel, cost,
and CII grade) is sound. It is **not** a certified compliance calculator — the
absolute grades depend on a single generic vessel coefficient, CII is per-voyage,
and the limitations above (especially #1, the missing infeasibility guard) should
be addressed before anyone treats an output as authoritative.
