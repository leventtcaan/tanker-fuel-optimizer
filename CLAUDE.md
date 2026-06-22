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
- [x] Phase 4 — FastAPI API. DONE. checks passed.
      - add deps: fastapi, uvicorn[standard], httpx. install in .venv.
      - backend/schemas.py (LegIn, OptimizeRequest, ScenarioOut, OptimizeResponse).
      - backend/main.py (CORS dev-only *, GET /health, POST /optimize).
        reuse voyage/optimizer/cii. no logic rewrite.
      - backend/test_api.py uses TestClient (no live server).
      - run good: health ok. optimize baseline E, optimized C, save 27.17%.
      - note: starlette TestClient warns httpx deprecate -> harmless, test pass.
- [x] Phase 5a — frontend scaffold + /optimize wiring (raw, no charts). DONE. build passes.
      - frontend/ = Next.js 14 (App Router, TS, Tailwind, ESLint, no src, alias @/*, npm).
      - no nested .git (monorepo one root .git).
      - frontend/.env.local NEXT_PUBLIC_API_URL=http://localhost:8000.
      - frontend/app/page.tsx client comp: hardcoded 3-leg storm, button "Optimize Et",
        POST /optimize, loading "Hesaplanıyor...", error handle, raw text result.
      - UI Turkish, code/comments English. minimal Tailwind.
      - npm run build -> compiled OK, lint+types OK.
      - DEBUG (5a verify live): button gave "Failed to fetch".
        ROOT CAUSE = port clash. another Docker app "mizan-backend" sits on
        :8000 + :3000 via IPv6 wildcard. macOS localhost -> ::1 first, so browser
        hit mizan (404, no CORS), not our app (IPv4 127.0.0.1:8000 only).
        our next dev also fell back to :3001 (3000 taken).
        FIX: .env.local -> http://127.0.0.1:8000 (force IPv4, dodge squatter).
             main.py CORS -> explicit origins 3000+3001 (localhost+127) not "*"
             ("*" + credentials is invalid spec; explicit list correct).
        did NOT kill user Docker/other server (non-destructive).
        VERIFIED live: backend up, curl with Origin localhost:3001 -> 200,
        ACAO echoed, baseline E, optimized C, saving 27.17%. headless proof
        (browser ext not connected). stack ran: backend :8000, frontend :3001.
      - 5a CLOSED: frontend/.env.example committed (127.0.0.1:8000, not ignored).
        README "Run locally" docs added (backend uvicorn, frontend cp+install+dev,
        use 127.0.0.1 not localhost). bg dev servers shut down + cleaned up.
- [ ] Phase 5b — NEXT = charts (map, charts). (define when start)
