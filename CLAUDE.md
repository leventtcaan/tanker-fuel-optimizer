# CLAUDE.md — caveman log

Ship burn fuel. Fast ship eat much fuel. Slow ship save fuel.

## RULES (always follow)
- One phase at time. No sprawl. No extra stuff.
- Read this file first. Do what phase say.
- Test before say done.
- Docstring in English. Explain physics.
- Commit small. Push when told.

## PHYSICS (remember)
- Power ~ V^3. Drag ~ V^2, power = drag * V.
- Daily fuel ~ V^3.
- Voyage fuel fixed distance ~ V^2 (less days when fast).

## PHASES
- [x] Phase 1 — backend fuel model + test. DONE. checks passed.
      - backend/fuel_model.py (daily_fuel, voyage_fuel)
      - backend/test_fuel.py (table: 16/14/12.6 kn, 2000 nm)
      - .gitignore, README.md
      - run output good: 16kn cost +30.6%, 12.6kn save 19%.
- [x] Phase 2 — legs + weather + speed optimizer. DONE. checks passed.
      - backend/requirements.txt (numpy, scipy). install in backend/.venv
        (anaconda base scipy broke vs numpy 2 -> use venv: .venv/bin/python).
      - backend/voyage.py (Leg dataclass, leg_fuel reuse daily_fuel, leg_time).
      - backend/optimizer.py (baseline_voyage, optimize_speed_profile SLSQP).
      - backend/test_optimizer.py (3 legs x700, storm middle 1.4, eta 175h).
      - two saving source: JIT slack + weather redistribute.
      - run good: baseline 281.83 t (idle 25h). opt speeds 12.47/11.15/12.47 kn,
        205.25 t. save 76.58 t = 27.2% = 238.16 t CO2.
- [x] Phase 3 — CII module (IMO tanker ref line + A-E grade). DONE. checks passed.
      - backend/cii.py (attained_cii, required_cii, cii_grade, rate_voyage).
      - real IMO const: CF 3.114, ref a=5247 c=0.610, Z by year, d1..d4 bounds.
      - CII annual in real life; here per-voyage for show.
      - backend/test_cii.py chains Phase 2 optimizer -> grade.
      - run good (dwt 40000, year 2026, 2100 nm): baseline E (ratio 1.435),
        optimized C (ratio 1.045). grade jump E -> C.
- [ ] Phase 4 — NEXT = FastAPI. (define when start)
