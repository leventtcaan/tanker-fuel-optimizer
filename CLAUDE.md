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
- [x] Phase 5b — charts (Recharts). DONE. build passes. NO map (that is 5c).
      - npm i recharts (3.8.1). no API/backend change. reuse result state.
      - frontend/app/components/:
        - SpeedProfileChart: BarChart per leg, storm leg (weather>1) red, calm blue.
        - FuelCompareChart: 2 bars Sabit Hız vs Optimize + saving_pct caption.
        - CiiBadge: 2 colored boxes + arrow, traffic light A/B green C yellow
          D orange E red. TR caption "CII Notu: E → C (iki kademe iyileşme)".
      - page.tsx renders the 3 below raw text when result exists.
      - gotcha: recharts 3 Tooltip formatter type strict -> drop ": number" annot.
      - npm run build OK. bundle 193kB first load (recharts).
- [x] Phase 5c — Leaflet map + real Med route + haversine. DONE. build passes.
      - npm i react-leaflet@4 (v5 needs React19, we are 18) + leaflet + @types/leaflet.
      - app/lib/voyageRoute.ts: WAYPOINTS (Gibraltar/Sardinia/Sicily/Aliağa),
        haversine (R=3440.065 nm), buildLegs -> 3 legs from 4 waypoints.
        GOTCHA: could NOT name it route.ts -> Next App Router reserves route.ts as
        a Route Handler (must export GET/POST). renamed to voyageRoute.ts.
      - app/components/RouteMap.tsx: MapContainer + TileLayer (OSM), markers+popups,
        per-segment Polyline colored by weather (red storm / blue calm).
        fixed broken default marker icon (mergeOptions w/ bundled PNGs).
      - page.tsx: payload legs = buildLegs() (map + optimizer SAME voyage).
        RouteMap via next/dynamic ssr:false (Leaflet uses window -> breaks SSR).
        layout: map top, then 5b charts, then raw text.
      - npm run build OK. bundle 195kB.
      - HEADS UP: real route = 1606 nm (< old 2100). at berth_eta=175h the deadline
        is loose (even vmin 10kn arrives 160.6h), so optimizer floors all legs to
        10kn, no weather redistribution shown. valid result, not a bug. did NOT
        change berth_eta (out of 5c scope) — revisit in 5d input form.
- [x] Phase 5d — interactive input form. DONE. build passes, live E->C verified.
      - no backend change. page.tsx now has controls panel (TR labels, EN code):
        berth_eta_h number+range (110-175), dwt, service_speed, year select 2023-26,
        per-leg weather sliders (1.0-1.6 step .1) wired via buildLegs -> map recolors.
      - button-only (no auto-run) = simple+robust. payload built from live state.
      - legs = useMemo(buildLegs(weather)). charts/map/badge all read live state.
      - TR caption: Med ECA 0.1% sulphur since 2025 -> fuel pricey -> saving matters.
      - DEFAULT_ETA: task said 128 for "E->C". MEASURED vs backend: 128h -> grade D,
        130h is the real C threshold. set default = 130 (honors E->C intent).
        live curl /optimize default payload: baseline E -> optimized C,
        speeds 12.61/11.28/12.61, saving 22.6%. storm leg slowest = redistribution.
      - npm run build OK. bundle 196kB.
- [x] Phase 6 — real sea routing (searoute). DONE. backend test green, build OK.
      BACKEND (done + verified first):
      - requirements: + searoute (1.6.0). NOTE searoute takes/returns [lon,lat].
      - ports.py: PORTS dict name->(lat,lon), 8 ports.
      - routing.py: get_sea_route (searoute, units=naut, swap to [lat,lon] for
        Leaflet, distance from properties.length), resample_to_legs (split ~78pt
        polyline into k contiguous chunks, haversine sum per chunk -> Leg objs).
      - schemas: OptimizeRequest +origin/+dest/+num_legs(6)/+weather, legs now
        OPTIONAL (backward compat). OptimizeResponse +route_coords.
      - main.py /optimize: origin+dest given -> real route -> resample -> use those
        legs + return route_coords. else legacy explicit legs. + GET /ports.
      - test_api.py: legacy test still E->C; NEW routing test İstanbul->Singapore
        num_legs6 eta480 -> 5858nm, 78 pts, E->C, 24% saving. ALL GREEN.
      FRONTEND (only after backend green):
      - page.tsx: two port <select> (Kalkış/Varış) from GET /ports. send
        origin+dest+num_legs+weather. ETA range widened 50-800 (routes vary
        240nm..6000nm). deleted now-unused app/lib/voyageRoute.ts.
      - RouteMap.tsx: polyline from response.route_coords, FitBounds via useMap,
        markers origin/dest only. (no more 4 hardcoded waypoints.)
      - 5b charts + CII badge + ECA caption still work off same result.
      - GOTCHA during verify: stale uvicorn on :8000 served old code (404 /ports);
        killed it, fresh start. localhost->Docker mizan (IPv6), use 127.0.0.1.
      - live: /ports=8, Gibraltar->İzmir eta130 = 1646nm 63pts E->C 18.2% saving.
      - npm run build OK. bundle 195kB.
- [x] Phase 7 — economics layer (cost on top). DONE. backend green, build OK.
      logic unchanged; cost added on top of fuel/CO2.
      BACKEND (done + verified first):
      - economics.py: REFERENCE (not live) prices PRICES_USD_PER_T (VLSFO586/
        LSMGO737/HSFO435), ETS_EUR_PER_TCO2=85. fuel_cost_usd, ets_cost_eur
        (eu_scope_fraction input; doc note ETS phase 2024=40/2025=70/2026=100%).
      - schemas: OptimizeRequest +fuel_type/+fuel_prices/+ets_price/+eu_scope_fraction.
        ScenarioOut +fuel_cost_usd/+ets_cost_eur. OptimizeResponse +money_saved_usd.
      - main.py /optimize: cost both scenarios via economics.py (import, no inline
        constants). money_saved = base.fuel_cost - opt.fuel_cost. + GET /prices.
      - test_api.py routing test: assert opt.fuel_cost<base.fuel_cost & money_saved>0.
        İstanbul->Singapore: base $406,482 -> opt $308,862, saved $97,620. GREEN.
      FRONTEND (after backend green):
      - page.tsx: "Ekonomi" group: fuel_type select (VLSFO/LSMGO/HSFO), editable
        price ("Referans Fiyat (düzenlenebilir)" NOT canlı) prefilled from /prices,
        ets_price, eu_scope_fraction(0-1 def 0). send all in payload.
        results show per-scenario fuel cost (+ETS when scope>0) + Para Tasarrufu.
      - step 6 of prompt was TRUNCATED ("Add a") -> completed sensibly as the
        results cost display + money-saved card.
      - GOTCHA: curl right after uvicorn start races (health up before routes) ->
        wait for /prices ready, then test. live: LSMGO+scope0.7 Gibraltar->İzmir
        base fuel$143652 ets€36114, opt $117499 €29539, saved $26153.
      - npm run build OK. bundle 196kB.
- [x] Phase 8 — ECA/SECA zones wired to blended cost. DONE. backend green, build OK.
      YAGNI: ECA = simple bbox, NOT exact IMO polygons (noted in docstring).
      BACKEND (done + verified first):
      - zones.py: ECA_ZONES bbox list (Med ECA since 2025-05-01, North Sea, Baltic).
        point_in_eca(lat,lon); eca_split(coords) -> (eca_nm, non_eca_nm) by segment
        midpoint + haversine.
      - economics.py: blended_fuel_cost_usd — split fuel pro-rata by distance,
        ECA share priced at eca_fuel (LSMGO), rest at open_fuel (VLSFO).
      - schemas: ScenarioOut +eca_nm/+non_eca_nm/+blended_fuel_cost_usd.
        OptimizeResponse +eca_zones (box list for drawing).
      - main.py /optimize: routed -> eca_split once, blended cost both scenarios,
        money_saved uses blended, return eca_zones. legacy legs keep flat cost.
      - test_api.py: assert eca_nm>0 & blended>flat. İstanbul->Singapore:
        eca 858nm / non-eca 5000nm, base flat $406482 -> blended $421823,
        money_saved(blended) $101304. GREEN.
      FRONTEND (after green):
      - RouteMap.tsx: ECA boxes as semi-transparent green Rectangle + name Tooltip.
      - page.tsx: "Rotanın X nm'si ECA içinde..." line; cost cards show blended
        (ECA karışık yakıt) when eca_nm>0; money card uses blended money_saved.
      - live: 3 boxes, eca 858/non 5000, blended>flat, saved $101304.
      - npm run build OK. bundle 196kB.
- [x] Phase 9 — PRUVA dark maritime UI (visual polish ONLY). DONE. build OK.
      NO backend/logic/optimizer/CII/economics touched. all features still work.
      - brand PRUVA, tagline "Akıllı Tanker Rota & Yakıt Optimizasyon Platformu".
      - globals.css: dark theme CSS vars (--bg/--panel/--border/--accent teal/
        --text/--muted + grade colors). .pruva-card/.pruva-input/.pruva-label.
        leaflet popup/tooltip dark.
      - layout.tsx: title PRUVA, lang=tr.
      - page.tsx: top bar (wordmark+tagline+honest DEMO pill). 3-col grid
        (lg:[320px_1fr_400px], stacks on mobile): LEFT collapsible Section groups
        (Rota/Sefer/Hava/Ekonomi) + teal Optimize btn w/ spinner. CENTER big map
        (fills viewport h). RIGHT result cards: big teal Para Tasarrufu, Yakıt&CII,
        ECA line, 3 charts. removed old raw-text fallback. numbers fmt tr-TR.
      - charts/CiiBadge restyled dark (pruva-card, dark axes/tooltip, pill+shadow
        badge, big teal arrow).
      - npm run build OK. bundle 197kB.
      VIEW LIVE: backend `cd backend && .venv/bin/uvicorn main:app --port 8000`,
      frontend `cd frontend && npm run dev`, open http://localhost:3000 (or 3001).
      MVP visually complete.
- [x] DEBUG — "Liman listesi yüklenemedi" (/ports fetch failed). FIXED + verified.
      ROOT CAUSE = CORS port mismatch. backend CORS allow-list only had 3000/3001.
      dev server fell back to :3002 (3000=Docker mizan, 3001=stale next-server from
      earlier phase), so browser origin localhost:3002 was blocked -> /ports (fires
      on mount) was first visible failure. /ports endpoint + .env.local + fetch base
      were all fine.
      FIX (1 line, not business logic): main.py CORS allow_origins list ->
      allow_origin_regex r"http://(localhost|127\.0\.0\.1):\d+" (any dev port).
      VERIFIED live (Origin localhost:3002): /ports = 8 ports; /optimize
      İstanbul->Singapore eta480 = 78 route pts, baseline E -> optimized C,
      money_saved $101304, eca_nm 858, 3 eca_zones. all green.
- [x] AUDIT — engine reviewed against reality. backend/AUDIT.md added.
      checked empirically (not just read): fuel coeff, optimizer edge cases, CII
      vs published IMO MEPC, economics math, ECA boxes, searoute distances, e2e.
      RESULT: NO formula/unit BUGS found -> 0 code fixes. engine constants all
      match IMO (CF 3.114, a5247/c0.610, Z, d1-d4 0.86/.94/1.06/1.18). distances
      ok (İst->Sing 5858, Rot->Sing 8368, Gib->İzmir 1646). c=0.0145 realistic
      (~40 t/day @14kn). lon/lat handling correct.
      APPROX (ok, disclosed): single vessel coeff, weather=fuel-only, ECA split by
      distance, single CF for MGO legs (~3% low), bbox ECAs, CII per-voyage
      (intensity -> grade independent of route length).
      LIMITATIONS flagged (NOT fixed, would change behavior): (1) no optimizer
      infeasibility guard (too-tight ETA silently violates deadline); (2) money
      saved = fuel only, excludes ETS; (3) blended cost ignores user fuel_type for
      routed legs; (4) Med bbox over-covers Black Sea (latent); (5) required_cii
      year fallback too strict for pre-2023.
- [x] FIX limitation #1 — optimizer feasibility guard. DONE. backend test green, build OK.
      - optimizer.py: min_time_h = sum(leg_time at vmax). if berth_eta < min_time ->
        return all-vmax fastest profile + feasible=False (+min_time_h). else solve
        as before + feasible=True. no other logic changed.
      - schemas: OptimizeResponse +feasible/+min_time_h. main.py passes through.
      - test_api.py: normal ETA -> feasible True; İst->Sing @10h -> feasible False,
        min_time 366.1h. GREEN.
      - page.tsx: red (grade-E) warning banner when !feasible: "⚠ Bu varış süresi
        imkansız ... En erken varış: X saat."
      - AUDIT.md limitation #1 marked [FIXED]/RESOLVED.
      - npm run build OK. bundle 197kB.
- [x] FIX default-ETA UX — route-aware defaults + graceful infeasible UX. DONE.
      PROBLEM: old default ETA 130 was below baseline (even min) time for most
      routes -> optimizer forced to all-vmax -> NEGATIVE saving on first load.
      BACKEND:
      - main.py GET /route_info?origin=&dest=&num_legs= -> distance_nm, min_time_h
        (all vmax), baseline_time_h (all 14kn), suggested_eta_h (round baseline*1.25).
        reuses routing + voyage.leg_time. tested İst->Sing: 366<418<523 all+.
      FRONTEND (page.tsx):
      - on mount + when origin/dest change -> fetch /route_info: ETA slider
        min=ceil(min_time) (can't pick infeasible), max=round(baseline*2),
        value=suggested_eta. hint "En erken varış: X sa".
      - infeasible (feasible=false): render ONLY red warning + "ETA'yı uygulanabilir
        yap" btn (sets eta=ceil(min_time), re-optimizes). hide money/CII/charts.
      - guard: money_saved<=0 never shown as big hero -> muted + "Bu ETA'da
        yavaşlama payı yok — ETA'yı artırın".
      - handleOptimize(etaOverride?) so the fix btn can re-run; main btn
        onClick={()=>handleOptimize()} (no event-as-eta bug).
      - VERIFIED: Gib->İzmir suggested eta147 -> E->A +36% $51758; İst->Sing
        eta523 -> E->A +36% $151842; make-feasible eta367 -> feasible but money
        <0 -> muted note (no negative hero).
      - npm run build OK. bundle 197kB.
- [x] TUNE suggested ETA ×1.25 -> ×1.12 (no logic change). credible ~C demo.
      ×1.25 gave grade A / ~36% (too optimistic). ×1.12 = modest slack -> ~C.
      VERIFIED: Gib->İzmir eta132 -> E->C +20.7% $29687; İst->Sing eta469 ->
      E->C +20.4% $86093. both feasible, grade C. no frontend change (reads
      suggested_eta from API). npm run build OK.
- [x] Phase A — real WPI ports dataset + searchable autocomplete. DONE. test green, build OK.
      DATA: backend/data/ports.json COMMITTED (NGA WPI, 3.1MB, 5410 records;
      3630 have names+coords -> indexed; 1780 location-only nameless skipped).
      bundled = offline + no runtime download dep.
      BACKEND:
      - ports.py rewritten: load json ONCE at import into in-memory list +
        lowercased search index. search_ports (rank: exact/prefix/substring then
        port_size), curated_ports (ISTANBUL/ALIAGA/IZMIR/KEPPEL/ROTTERDAM/FUJAYRAH),
        port_by_name, resolve_latlon (accepts "lat,lon" OR name; 70 dup names ->
        frontend sends lat,lon).
      - main.py: GET /ports/search?q=&limit; GET /ports now curated objects;
        /optimize + /route_info resolve origin/dest via resolve_latlon (name or coords).
      - test_api.py: q=izmir -> IZMIR Turkey 38.43,27.13; q=singapore -> KEPPEL;
        searched IZMIR->Singapore E->C +20.3% $82747; infeasible@10h ok. GREEN.
      FRONTEND:
      - components/PortCombobox.tsx: debounced(300ms) /ports/search, dropdown
        name+country, title-case UPPERCASE names. sends selected port as lat,lon.
      - page.tsx: 2 comboboxes (Kalkış/Varış) replace selects. default-fill
        İstanbul->Singapore from /ports. route_info fires on originRef/destRef.
      - npm run build OK. bundle 198kB.
- [ ] Phase B — NEXT. (define when start)
