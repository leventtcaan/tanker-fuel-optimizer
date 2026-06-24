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
- [x] Phase B — live Open-Meteo marine weather -> per-leg factors. DONE. test green, build OK.
      BACKEND:
      - weather.py: Open-Meteo Marine (free, no key). wave_to_weather_factor
        (<1m=1.0 .. >5m=1.6, banded). async fetch_leg_weather: ALL legs via
        asyncio.gather (concurrent), per-request 4s timeout, on error -> calm 1.0
        fallback (never hangs). 10-min TTL cache keyed by rounded lat/lon.
      - routing.py: leg_midpoints(coords,k) -> representative point per leg.
      - schemas: OptimizeRequest +auto_weather(bool=True); OptimizeResponse
        +legs_weather [{factor,wave_m,source}].
      - main.py /optimize now ASYNC: if auto_weather & routed -> leg_midpoints ->
        await fetch_leg_weather -> factors override manual sliders; return legs_weather.
      - AUDIT.md: wave->factor band heuristic added as disclosed limitation #7.
      - test_api.py: auto_weather=True -> 6 legs factor in[1,1.6] in 1.4s (live:
        leg5 wave2.18m->1.25); forced-unreachable -> all 1.0 fallback. existing
        routing/infeasible tests set auto_weather=False (deterministic). GREEN.
      FRONTEND:
      - page.tsx Hava: "Otomatik Hava (canlı)" toggle (default ON). ON -> sliders
        read-only + auto-filled from legs_weather, per-leg wave_m + "● canlı"/
        "○ varsayılan" badge by source. caption: Open-Meteo, çarpan=bizim eşlememiz.
        OFF -> manual sliders. sends auto_weather in payload.
      - npm run build OK. bundle 198kB.
- [x] Phase C — map visual upgrade. DONE. build OK. MVP visually complete.
      no optimizer/CII/economics/weather logic touched.
      BACKEND (small):
      - data/zones.geojson COMMITTED: polygon-accurate (not bbox) zones — Med ECA,
        North Sea ECA, Baltic ECA, + Gulf of Aden/NW Indian Ocean HRA. props
        {name,type ECA|HRA,color}. zones.py bbox COST logic unchanged.
      - main.py: GET /zones -> FeatureCollection (loaded once at import).
      - AUDIT.md #4: display no longer over-covers (polygons); bbox cost note kept.
      FRONTEND (RouteMap.tsx):
      - base CARTO Dark (+ Voyager option) instead of OSM; OpenSeaMap seamark
        transparent overlay. LayersControl top-right: ECA Bölgeleri / Korsanlık
        (HRA) / Deniz İşaretleri toggles + 2 base layers.
      - /zones polygons: ECA teal semi-transp + tooltip; HRA red dashed + tooltip.
      - route: white casing + per-leg teal line, storm legs (factor>1.2) red
        (split polyline into legsWeather chunks). origin teal-dot DivIcon, dest
        flag DivIcon, name popups. fit bounds. ssr:false kept.
      - map taller/hero (lg h calc(100vh-6rem), min 480). 3-col holds, stacks mobile.
      - npm run build OK. bundle 198kB.
- [x] Phase D — click map to pick nearest port. DONE. backend test green, build OK.
      YAGNI: brute-force nearest over in-memory ports (~3630), no spatial index.
      BACKEND (done + verified first):
      - ports.py: nearest_port(lat,lon) -> closest NAMED port by haversine over
        PORTS list. local _haversine_nm helper (mirrors routing, no searoute
        import pulled into ports). returns {id,name,country,lat,lon,distance_nm}.
      - main.py: GET /ports/nearest?lat=&lon= -> nearest_port (404 if none).
      - test_api.py: test_nearest_port — click (38.4,27.1)->IZMIR Turkey 2.3nm;
        click (1.27,103.8)->PULAU BUKOM Singapore 3.0nm. both <60nm. GREEN.
      FRONTEND (after green):
      - page.tsx: pickMode state ("off"|"origin"|"dest", default off). toggle
        "Haritadan seç: [Kalkış][Varış][Kapalı]" above map. handleMapPick(lat,lon)
        -> GET /ports/nearest -> setOriginPort/setDestPort (route_info refetches).
      - RouteMap.tsx: MapClickPicker via useMapEvents 'click' -> onMapPick;
        crosshair cursor while active. new optional props pickMode/onMapPick.
      - npm run build OK. bundle 198kB.
- [x] Phase E — composition pass (layout/initial-load UX ONLY). DONE. build OK.
      NO logic touched (optimizer/CII/economics/weather/routing/API unchanged).
      page.tsx only:
      - FIRST-LOAD AUTO-OPTIMIZE: didAutoRun useRef guard. on first successful
        /route_info (default İstanbul->Singapore) auto-call handleOptimize(
        suggested_eta) ONCE -> map draws route + right panel filled on load.
        ref guard => never re-runs when user later changes ports.
      - RIGHT PANEL resting state: skeletons (animate-pulse) while initial
        loading (!result && loading); compact "Nasıl çalışır" 3-step mini-card
        otherwise. never blank.
      - LEFT PANEL shorter: Hava + Ekonomi Sections defaultOpen={false} (start
        collapsed); Rota + Sefer stay open (essentials).
      - BALANCE: tighter spacing — Section py-3->2.5 mt/space-y-3->2.5, grid
        gap/p-4->3, right col space-y-4->3, button mt-4->3. fits ~900px laptop.
      - still 3-col desktop / stacked mobile. npm run build OK. bundle 198kB.
- [x] Phase F1 — swap cubic fuel model for log-linear (Admiralty-extended). DONE.
      backend test green, build OK. plan = _reference/PLAN.md (F1 only here).
      teammates present this formula -> app must flow by it. reimplemented in OUR
      style, NOT imported from _reference/their_project.
      FORMULA (fuel_model.daily_fuel_loglinear):
        FC = FC0*(V/Vref)^b1 * exp(b2*B + b3*Hs + b4*cosθ + b5*(Dm-10) + bL*load
             + b7*(d_DD-180)). literature/slide coeffs (formula.png): Vref12 b1
             2.85 b2 .082 b3 .055 b4 -.048 b5 .031 bL .17 b7 .00021.
        FC0=26 -> calm 12kn = 27 t/day (25-30 band). voyage fuel ~V^1.85 (was V^2),
        still monotonic up in V -> SLSQP + feasibility guard unchanged.
      F1 SCOPE: B=0, θ=0 (live wind/angle = later phase). Hs DERIVED from existing
        per-leg weather factor via voyage.weather_factor_to_wave_m (inverse of
        weather.py band: 1.0->0m, 1.6->5m) so weather redistribution survives.
        new OPTIONAL inputs: draft_dm=12, days_since_drydock=180, load=0.5.
      KEEP CII/economics/optimizer structure (consume fuel TONS, insulated). old
        cubic daily_fuel/voyage_fuel kept but marked DEPRECATED (test_fuel still
        uses them).
      FILES: fuel_model.py (+loglinear, deprecate cubic), voyage.py (leg_fuel ->
        loglinear + wave helper), optimizer.py (thread draft/load/d_dd/fc0, drop
        c), schemas.py (+draft_dm/days_since_drydock/load), main.py (thread them),
        AUDIT.md (F1 update note + re-baseline), test_api.py (re-baselined asserts).
      RE-BASELINE (numbers shift w/ model, expected): legacy 3-leg storm E->C
        (cubic) -> now E->D 25.0% $43516. İzmir->Sing E->C -> now E->D 19.0%
        $86393. baseline still E. all test_*.py green (.venv/bin/python).
      FRONTEND (small, F1 surfacing only — reskin is F5): Sefer section +Draft Dm,
        +Drydock'tan gün, +Yük oranı slider (0-1). sent in /optimize payload.
        npm run build OK. bundle 199kB.
- [x] Phase F2 — live wind -> Beaufort (b2·B) + wind-angle (b4·cosθ) in formula.
      DONE. backend test green, build OK. fuel_model UNCHANGED (F1 already had
      beaufort + wind_angle_rad params) — F2 just feeds real values.
      BACKEND:
      - weather.py: fetch wind_direction_10m too (wind_speed_unit=ms). new
        wind_ms_to_beaufort(ms)->0..12 (standard scale). dict now has beaufort +
        wind_dir. fallback = B0, wind_dir None (never crash).
      - routing.py: leg_bearing(p0,p1) compass heading; leg_bearings(coords,k)
        per-leg heading (same chunk scheme as midpoints). resample_to_legs +beaufort
        +wind_angle_rad lists.
      - voyage.py: Leg +beaufort +wind_angle_rad. relative_wind_deg (folded 0..180,
        0=headwind 180=following). wind_angle_rad_from: SIGN CONV — b4=-0.048, map
        angle so headwind->π->cos -1->+0.048 (more fuel), following->0->cos1->-0.048
        (less), beam neutral, no-wind=calm baseline. leg_fuel passes B + angle.
      - main.py: leg_bearings + per-leg theta from wind_dir vs heading; legs_weather
        +bearing_deg +theta_deg. auto_weather=False / legacy legs unchanged.
      VERIFY (.venv): legacy still E->D 25.0% (wind defaults = F1 exactly). İst->Sing
        live auto_weather: B per leg 2-5, theta computed, E->E 19.4% $122625 (live
        wind added fuel). sign check 700nm@14kn B6: headwind 167t > following 152t >
        calm 93t. monotonic+feasible intact. CII/economics untouched.
      AUDIT.md: F2 note — wind/Beaufort live, theta from bearing vs wind dir,
        approx (single midpoint, current-time, straight-line heading).
      FRONTEND (small): per-leg weather line now shows "· Bft N ↘" (windArrow =
        toward dir) next to wave + ● canlı. npm run build OK. bundle 199kB.
- [x] Phase F3 — live ocean current -> SOG (speed-over-ground) model. DONE.
      backend test green, build OK. current affects TIME (fuel still STW-only).
      BACKEND:
      - weather.py: marine fetch +ocean_current_velocity(km/h->kn *0.539957)
        +ocean_current_direction. dict +current_kn +current_dir. fallback cur 0.
      - voyage.py: Leg +current_along_kn (signed: + following, - head). V_MIN_SOG
        2.0. current_along_kn(Vc,dir,brng)=Vc·cos(brng-dir) (dir=toward, ocean
        conv). leg_sog(V,leg)=max(V+current_along, 2.0). leg_time NOW uses SOG.
      - optimizer.py UNCHANGED in shape — minimizes ΣlegFuel (STW) + JIT constraint
        & min_time guard go via leg_time -> auto SOG. following lets STW drop (less
        fuel), head forces STW up (more), head raises min_time.
      - routing.py resample_to_legs +current_along list. main.py: project current
        per leg via bearing; legs_weather +current_kn +current_dir +sog_kn(opt).
      VERIFY (.venv): controlled 700nm@STW12: foll SOG14/50h, none 12/58h, head
        10/70h (fuel same — STW fixed). optimizer fixed-ETA 3x700: foll 163.5t <
        none 209.3t < head 260.3t. min_time none131h < head(-3)161h. legacy/
        auto_off byte-identical to F2 (E->D 25.0%). İst->Sing live: per-leg cur
        ~0.2-1.0kn, SOG vs STW sane, E->E 23.1% $146178, feasible.
      AUDIT.md: F3 note — live current, SOG model, approx (surface only, single
        midpoint, current-time, straight-line bearing; current=time not fuel).
      FRONTEND (small): per-leg sub-line "Akıntı X kn ↗ · SOG Y kn" (currentArrow
        = toward dir, no 180 offset). npm run build OK. bundle 199kB.
- [x] Phase F4 — alternative routes with tradeoffs. DONE. backend test green, build OK.
      PROBE (step 0, recorded in _reference/PLAN.md): searoute 1.6.0 SUPPORTS real
        restrictions (passages: babalmandab/bosporus/gibraltar/suez/panama/ormuz/
        northwest). İst->Sing default 5861nm via Suez crosses HRA; avoid suez/
        babalmandab = 12574nm Cape, no HRA. -> use REAL restricted routing for
        hra_avoiding; waypoint-nudge (concat origin->wp->dest) for weather/current.
      BACKEND:
      - routing.py: get_sea_route +restrictions param (passthrough to searoute).
      - alt_routes.py NEW: crosses_hra (HRA polys from zones.geojson, ray-cast),
        worst_leg_index (wave factor + head-current), hra_avoiding_route (restrict
        suez+babalmandab+northwest), weather_current_route (nudge worst leg mid
        ~1.5° perp, stitch 2 real legs; omit if <2% deviation or no worst leg).
      - main.py: POST /alternatives (same inputs as /optimize, needs origin+dest).
        _legs_and_weather helper (same auto-weather leg build as /optimize, kept
        separate so /optimize untouched) + _score_candidate (baseline+optimize+
        cii+blended cost). candidates: shortest (always) + hra_avoiding (only if
        shortest crosses HRA) + weather_current (only auto_weather & worst leg).
        recommended = lowest-fuel FEASIBLE. /optimize unchanged (backward compat).
      - candidate dict has baseline+optimized fuel/cii(attained+ratio+grade)/cost,
        saving_pct, money_vs_shortest, crosses_hra, eca_nm, feasible, route_coords,
        legs_weather, speeds -> frontend can rebuild result cards from a candidate.
      HONESTY: weather_current = waypoint-nudge APPROX (not weather-graph routing);
        omitted in calm seas (no faked line). disclosed in code + AUDIT.md.
      VERIFY (.venv): /alternatives İst->Sing (auto off, eta1100) = 2 cands:
        shortest 5861nm crossesHRA ★, hra_avoiding 12574nm no-HRA; exactly 1 rec;
        each saving>0; grades valid. live auto_weather = 2 cands when seas calm
        (worst_leg None -> weather_current honestly omitted). direct test: synthetic
        storm+head-current leg -> worst_leg_index works, nudge +111nm distinct.
      FRONTEND: "Rota Alternatifleri" compare panel (cards: label, mesafe/süre/
        yakıt/maliyet, CII colored, kısaya-göre fark, HRA/ECA/yaklaşık/ETA badges,
        teal "Önerilen"). click candidate -> altToResult() feeds existing result
        cards + draws THAT route in its color (ALT_COLORS teal/amber/purple) via
        RouteMap routeColor prop. "En kısaya dön" resets. CII CARD FIX: shows
        "Atılan CII X.X -> Y.Y" + "bir alt CII kademesine %N kaldı" (pctToNextGrade
        from IMO bounds) so improvement visible even E->E. npm run build OK. 200kB.
- [x] Phase F5 — dashboard reskin matching presented PRUVA layout. DONE. build OK.
      PURE PRESENTATION — ZERO logic/number/endpoint changes (optimizer/CII/econ/
      weather/routing/alt-routes untouched). frontend page.tsx + RouteMap only.
      target = _reference/screens/dashboard.png LAYOUT (NOT its fake data, NOT
      Karadeniz branding — standalone product). kept honest DEMO pill.
      - TOP METRIC BAR (new MetricBar comp): full-width strip under header —
        Brent/VLSFO/LSMGO/EU ETS. VLSFO/LSMGO/ETS from existing /prices state;
        Brent = frontend DEFAULT_BRENT const (since /prices has no Brent). labeled
        "Piyasa · referans" + "canlı değil · düzenlenebilir" (honest, not canlı).
      - RIGHT "SEFER TAHMİNİ" card (restructured, replaces old Yakıt&CII card):
        header (origin->dest · süre · "Gerçek Deniz Rotası"); KRİTİK UYARI list
        DERIVED client-side from route_coords (HRA bbox + Süveyş/İst.Boğazı/Malacca
        lon-lat gates) + eca_nm; zone chips (ECA: X nm / HRA: var-yok colored);
        2-col METRIC GRID (Metric comp): Mesafe, Sefer Süresi+ETA, Tahmini Yakıt
        baz->opt, Tahmini CO2 (fuel*3.114 display-only), Yakıt Maliyeti baz->opt,
        EU ETS. all from EXISTING response fields. Para Tasarrufu hero + CII pill
        (E->E attained X->Y + % to next grade) kept.
      - DENSITY: per-leg live detail wrapped in nested collapsible "Bacak
        detayları" (closed) + max-h-44 scroll; tightened paddings; map stays hero;
        3-col desktop / stacked mobile. Rota Alternatifleri (F4) panel kept in
        right column, usable.
      - HONESTY: no field invented — HRA/chokepoints derived from returned
        route_coords bbox/gates; CO2 = fuel×CF (same factor engine uses, display
        only); prices clearly reference. npm run build OK. bundle 201kB.
      MVP feature + visually complete.
- [x] CO₂ emission reduction = PRIMARY metric (display only). DONE. build OK.
      PURE PRESENTATION — no logic/number/endpoint/formula change. page.tsx only.
      brief goal = fuel saving AND ~5% CO2 reduction; CO2 was secondary -> now a
      hero peer of Para Tasarrufu.
      - display-only compute from EXISTING fields: co2_baseline=baseline.fuel_t*
        3.114, co2_optimized=optimized.fuel_t*3.114, co2_saved, co2_reduction_pct
        (same CF the engine uses; no recompute of any result).
      - new "CO₂ Emisyon Azaltımı" card (green --grade-a accent) right after Para
        Tasarrufu: big "%Z azaltım", "X t -> Y t CO₂ (−W t)", subtitle
        "Hedef: ≥%5 — Ulaşılan: %Z" (✓ if met). honest (no fake target logic).
        muted state when co2_saved<=0.
      - CII pill REFRAMED as regulatory layer: eyebrow "Regülasyon · IMO CII"
        above CiiBadge; attained X->Y + % to next grade kept.
      - right panel order: Para Tasarrufu + CO₂ Azaltımı (heroes) -> Sefer Tahmini
        -> Regülasyon/CII -> charts -> alternatives.
      - npm run build OK. bundle 201kB.
- [x] 3 visual fixes (display only, no logic/number/endpoint/formula change). build OK.
      FIX1 fit-to-one-screen: header py-3->2 (text-lg), metric bar py-2->1.5,
        grid p-3->2 gap-3->2, Section py-2.5->2 + title text-[13px], heroes p-5->4
        text-4xl->3xl. LEFT + RIGHT columns now lg:h-[calc(100vh-5.5rem)] +
        overflow-y-auto (scroll INTERNALLY) so page never grows tall; map stays
        hero; 3-col desktop / stacked mobile.
      FIX2 day-based durations: fmtDuration(h) helper — h>=48 -> "X gün Y sa
        (Z sa)", else "Z sa". applied to ETA slider label, En erken varış, infeasible
        warning, Sefer Süresi metric + ETA hedefi, route header time. slider/API
        still operate in HOURS — only the LABEL adds days.
      FIX3 smoother map (RouteMap.tsx + globals.css): zone polygons smoothFactor 3,
        rounded joins, softer fills (ECA teal 0.14 / HRA red 0.13 dashed "6 6"),
        1.8px brighter strokes. route: white casing weight9 op.45 + teal weight5,
        round lineCap/lineJoin, subtle .pruva-route-glow drop-shadow (route only,
        not zones). storm-leg red kept. CARTO dark + OpenSeaMap + layer control
        intact. npm run build OK. bundle 201kB.
- [x] Map -> LIGHT professional basemap (Signal-Ocean style). display only, map only.
      RouteMap.tsx + globals.css (panels/cards untouched).
      - DEFAULT basemap now CARTO Voyager (light, subtle labels); CARTO Koyu (dark)
        still selectable in layer control. OpenSeaMap overlay + control kept.
      - route: understated navy (#1f3a57) line weight 3 + thin white casing weight6
        (was thick teal weight5 + glow); removed .pruva-route-glow. storm legs red
        (#e11d48) slimmer. routeColor default ROUTE_TEAL -> ROUTE_NAVY (alt-route
        teal/amber/purple still read on light).
      - markers: elegant SVG teardrop pins (was teal dot + 🏁 flag) — origin navy,
        dest red, white center dot, soft drop-shadow.
      - zones softer on light: ECA teal fill 0.10 + 1.2px #0d9488 stroke; HRA red
        fill 0.10 + 1.3px dashed (5 6) stroke. smoothFactor 3 kept.
      - globals.css: popups/tooltips now LIGHT (white bg, navy text, subtle border+
        shadow); attribution light. (were dark-panel styled.)
      - npm run build OK. bundle 201kB.
- [x] Chart tooltip/hover fix (display only, no logic/data change). build OK.
      SpeedProfileChart + FuelCompareChart (Recharts):
      - replaced default <Tooltip contentStyle> with custom content components
        (SpeedTooltip/FuelTooltip) — themed card: rounded, border --border, bg
        --panel, text --text, small label+value, padding. fixes washed-out/
        light-on-light contrast.
      - cursor={false} on both Tooltips -> removes the gray hover "ghost" bar.
      - tooltip content: Speed = "Bacak N" + "Hız X.X kn" + "Hava çarpanı X.X
        (· fırtına)" (added weather to datum from legs prop, existing data).
        Fuel = bar name + "Yakıt X t" (tr-TR rounded).
      - polish: gridlines/axes var(--border)/var(--muted), tickLine off, axisLine
        subtle; rounded bar tops kept. calm bar blue->teal (--accent), caption
        "mavi"->"turkuaz". storm red + optimized green + baseline gray kept.
      - npm run build OK. bundle 202kB.
- [x] Zones -> soft painted regions (display only, zones only). build OK.
      RouteMap.tsx + globals.css. less outline, more fill (reference-tool look).
      - ECA: fillOpacity 0.10->0.20, stroke weight 1.2->1 + opacity 0.25 (near
        borderless teal wash). HRA: fill 0.10->0.15, weight 1 + opacity 0.30,
        dashArray "5 6"->"2 7" (faint risk hint, not bold dashed border).
      - smoothFactor 3->6 (rounder shapes). className "pruva-zone" in pathOptions
        -> globals.css .pruva-zone { filter: blur(1.3px) } feathers edges (zones
        only; route paths keep crisp edges, stay ON TOP — declared after zones).
      - tooltips on hover + layer toggles (ECA/HRA/OpenSeaMap) unchanged. basemap
        + panels untouched. npm run build OK. bundle 202kB.
- [x] Phase F6 — re-optimize on input change + per-leg fuel + distance-based legs.
      DONE. backend test green, build OK. browser ext NOT connected -> verified
      headless via curl (project's established method).
      RE-OPTIMIZE BUG: changing voyage inputs (ETA/speed/DWT/draft/drydock/load/
        weather mode/fuel/year/ports) left fuel/CII/cost STALE. ROOT CAUSE = nothing
        re-ran /optimize on change: only a once-guarded auto-run on first load +
        the manual button. The button itself read current state fine, but ports
        changing updated ETA bounds while the shown result stayed stale until a
        click; no effect watched the other inputs at all.
        FIX (page.tsx): didAutoRun ref still fires the first auto-run ONCE. Added a
        debounced (600ms) re-optimize effect keyed on an optSig signature of every
        input that changes output. lastOptSig ref records what was last optimized;
        effect fires only on a REAL change and never loops on its own state
        updates (result/loading/alts not in sig; berthEta only set on override).
        Weather excluded from sig when auto_weather ON (server replaces it;
        read-only sliders + slider-resize must not trigger). Button still always
        re-runs current state; first-load auto-run preserved. no infinite loop.
      PER-LEG FUEL (backend-first): schemas +PerLegOut; OptimizeResponse +num_legs
        +per_leg [{leg_index,distance_nm,speed_kn,fuel_t,baseline_fuel_t,
        weather_factor,beaufort,wave_m,current_kn,sog_kn}]. main.py builds per_leg
        reusing voyage.leg_fuel/leg_sog (NO new physics). per_leg fuel sum ==
        voyage total (verified 629.8 t == 629.8 t). frontend: new collapsible
        "Bacak Bazında Yakıt" table (right panel) showing each leg's fuel + speed +
        wave/Bft, storm legs dotted red.
      DISTANCE-BASED LEGS: routing.legs_for_distance (~1 leg/500nm, clamp 3..12) +
        polyline_distance_nm. schemas num_legs Optional (None=computed; explicit
        still overrides). main /optimize + /route_info + /alternatives (per
        candidate) resolve n_legs from route distance. /route_info returns num_legs.
        VERIFIED: İzmir->İstanbul 278nm=3 legs, İst->Singapore 5861nm=12; forced
        num_legs=5 respected. frontend stops sending num_legs (backend computes),
        reads num_legs from /route_info to size weather sliders.
      LEG-BOUNDARY DOTS (RouteMap.tsx): CircleMarker at each leg boundary (same
        chunk math as backend) with tooltip "Bacak N: X kn · Y t · dalga Z m";
        navy dot, storm-leg-start red. perLeg prop drives count+tooltips (falls
        back to legs_weather for alt routes).
      test_api.py +test_per_leg_and_segmentation (per_leg len==num_legs, fuel/dist
        sums match totals, leg count scales long>short + clamps, override wins).
        ALL backend tests green. npm run build OK. bundle 202kB.
- [x] DEBUG — F6 422 Unprocessable Entity on /optimize. FIXED + verified (curl).
      NOT a static schema mismatch: default payload to /optimize, /alternatives,
      /route_info all 200. ROOT CAUSE = F6's debounced auto-reoptimize now POSTs
      on EVERY input change, including mid-edit. The free-text number inputs
      (DWT/Draft/Servis Hızı/Drydock) do setX(Number(e.target.value)); clearing
      one makes Number("")===0, and the debounce fires that 0. Schema has dwt gt=0
      + draft_dm gt=0 -> 422 ({"type":"greater_than","loc":["body","dwt"|"draft_dm"]}).
      Pre-F6 nothing auto-fired so an empty field never reached the server.
      FIX (frontend, page.tsx — backend gt=0 is correct, kept; 0 dwt/draft is
        meaningless + breaks fuel/CII math, so NOT loosened): added inputsValid
        guard (dwt>0, draft_dm>0, service_speed>0, days_since_drydock>=0,
        berth_eta_h>0, load in [0,1]). handleOptimize early-returns w/ TR error if
        invalid; debounce effect returns without POSTing; Optimize btn disabled
        until valid. Frontend now never sends a schema-invalid payload.
      VERIFIED: curl dwt=0 / draft_dm=0 -> 422 at backend (guard still protective);
        valid payload -> /optimize, /alternatives, /route_info all 200. test_api.py
        suite green. npm run build OK. bundle 202kB.
- [x] Phase F9 — live VesselFinder vessel data (5 Karadeniz Holding tankers). DONE.
      backend test green, build OK.
      SECURITY: key ONLY in backend/.env (gitignored), read via os.getenv(
        "VESSELFINDER_API_KEY") at call time. NEVER hardcoded/logged. .env.example
        committed with EMPTY placeholder. added python-dotenv (load_dotenv at
        import; doesn't override real env). verified .env ignored, .env.example
        committable, no key value in any tracked file.
      TRIAL LIMIT (5 vessels / 5 days / 1 query/hour) RESPECTED: vessels.py fetches
        ALL 5 IMOs in ONE batched call (API takes comma-sep imo list), caches per
        IMO 1h (CACHE_TTL_S=3600), + process-level rate guard (_MIN_CALL_INTERVAL
        3600, timestamp set BEFORE request so failures don't retry-hammer).
      BACKEND vessels.py: VESSELS = 5 KH IMOs (9359600/9447287/9311646/9378022/
        9443841) + placeholder names. async fetch_vessel(imo) -> {imo,name,
        speed_kn,lat,lon,draught_m,dwt,destination,course,heading,nav_status,...}
        from https://api.vesselfinder.com/vessels?userkey&imo&format=json&
        extradata=master (AIS SPEED kn / DRAUGHT m; MASTERDATA DWT+NAME). graceful
        fallback {available:false,reason} on no key / error / over-limit / non-list
        payload (trial returns a JSON error string -> isinstance(list) guard, no
        crash). main.py: GET /vessels (static list, NO api call) + GET
        /vessels/{imo} (404 if not fleet, else fetch_vessel; never raises).
      VERIFIED: offline mock proves BOTH branches (error-string -> available:false;
        valid array -> available:true speed 12.4 dwt 74000 name from MASTERDATA),
        ZERO live calls. one real call during test_api.py -> trial over-limit ->
        clean fallback available:false reason=unavailable (no crash). /vessels live
        on server = 5 entries. test_api.py +test_vessels (5 entries, 404 unknown,
        detail has 'available', tolerant of live-or-fallback) +
        test_vessels_no_key_fallback (pop key -> available:false reason=no_api_key,
        no API call). ALL green. did NOT re-hit /vessels/{imo} on server (preserve
        quota; behavior already proven).
      FRONTEND page.tsx: "Gemi (Karadeniz Holding)" Section (dropdown, after Rota).
        select -> GET /vessels/{imo}; available -> autofill DWT + draft (editable;
        debounce re-optimizes) + "● Canlı veri" note; !available -> "○ Canlı gemi
        verisi alınamadı (trial/limit)" note, manual inputs still work. results
        panel: "Gemi vs PRUVA" card = geminin anlık hızı X kn vs PRUVA önerisi
        (dist-weighted avg of optimized per-leg speeds) Y kn + fark/tasarruf note.
        manual port/DWT entry unaffected. npm run build OK. bundle 203kB.
- [x] DEBUG F9b — vessel available:false root cause + clearer reasons. DONE (1 live call).
      DIAGNOSED (masked, 1 controlled call): request is CORRECT per docs —
        GET api.vesselfinder.com/vessels?userkey=<masked>&imo=<csv>&format=json&
        extradata=master -> HTTP 200, application/json, body {"error":"Invalid
        Userkey!"}. So NOT the hourly limit and NOT a param/endpoint/format
        mismatch: the KEY in .env (len 17, looks like a placeholder) is rejected
        as invalid. Old code raise_for_status + bare except discarded the body and
        the non-list branch mislabeled this AUTH error as generic "unavailable"
        (UI showed "trial/limit").
      FIX (vessels.py, no request change needed): drop raise_for_status; read
        status+body; _classify_error -> stable reason codes auth / rate_limited /
        request_error / network (auth = Invalid Userkey/401/403/inactive/expired;
        rate_limited = quota/limit/429). _refresh_all returns the reason +
        remembers _last_reason so while the 1h guard blocks calls we still report
        the TRUE cause (invalid key) not a fake limit. fetch_vessel returns the
        real reason. FRONTEND: VESSEL_REASON_TR maps codes -> TR ("Trial aktif
        değil / geçersiz anahtar", "Saatlik sorgu limiti", "İstek hatası",
        "Bağlantı hatası"); note shows which cause was hit.
      VERIFIED offline (0 live calls): _classify_error + fetch_vessel mock ->
        Invalid Userkey=auth, 403=auth, quota=rate_limited, 429=rate_limited,
        bad param=request_error, valid array=available. test_api.py
        +test_vessel_reason_classification (pure fn). full suite green (live
        test_vessels skipped to honor the one-call budget). npm run build OK.
      CONDITION FOR A SUCCESSFUL LIVE CALL: set a VALID VESSELFINDER_API_KEY in
        backend/.env (current value returns "Invalid Userkey!"). Request format is
        already correct; a valid key returns the {AIS, MASTERDATA} array.
- [x] DEBUG F9c — VesselFinder response parsing (wrong endpoint). DONE (1+1 live calls).
      After a valid key (WS… len 18) was set, /vessels/{imo} -> request_error.
      DIAGNOSED (1 masked live call): GET api.vesselfinder.com/vessels -> HTTP 200
        {"error":"Method is not permitted!"}. Docs show TWO families: credit-based
        "Vessels" (/vessels) vs SUBSCRIPTION-based "VesselsList". Our key is a
        VesselsList subscription, so the /vessels (credit) endpoint is not
        permitted. ROOT CAUSE = wrong ENDPOINT, not a parse/shape bug.
      FIX (vessels.py): endpoint -> https://api.vesselfinder.com/vesselslist.
        VesselsList returns the account's PREDEFINED fleet (NO imo param) as a
        top-level array of {AIS, VOYAGE, MASTERDATA} — fits our single-call +
        1h-cache design. dropped imo param; kept userkey+format=json+
        extradata=master. parser (_parse: AIS speed/lat/lon/draught + MASTERDATA
        DWT) unchanged — it already matched. masked-key security, 1h cache,
        classify+fallback all kept.
      VERIFIED (1 live call via real fetch_vessel): available:true — IMO 9359600 =
        "KPS AYBERK BEY", speed 0.0 kn (NAVSTAT 5 moored), pos 40.699,29.456
        (Marmara), draught 5.2 m, dest "TR YAL". All 5 fleet IMOs returned+cached
        (account fleet == our 5 KH tankers). dwt=None: MASTERDATA not in this
        plan's response -> parsed gracefully (frontend autofill guards dwt>0, so
        it just skips DWT; draft autofills). offline mocks: AIS-only->available
        dwt None; AIS+MASTERDATA->dwt 74000; error body->available false.
        test_api.py +test_vessel_parsing_offline (deterministic, no live call).
        full suite green (live test_vessels skipped to honor the call budget).
- [x] Final revisions pass — ETA/speed clarity + idle-days + hull advisory + moored
      card + more ECA/SECA on map. DONE. build OK. NO formula/optimizer change.
      (1) ETA vs Servis Hızı clarity (page.tsx Sefer): ETA now in an accent-bordered
          box "Liman Varış Süresi — ETA (kısıt)" + helper "Optimize hedefi: gemi bu
          süreye kadar varmalı (kısıt)." Servis Hızı own block "Servis Hızı (kn) — baz"
          + helper "Karşılaştırma için baz hız — optimize ondan bağımsız hesaplanır."
          (visually separated so they don't read as linked).
      (1b) more ECA/SECA on map (display only): data/zones.geojson +Kuzey Amerika ECA
          (Atlantik/Pasifik/Meksika Körfezi) + ABD Karayip ECA polygons (approx,
          [lon,lat], closed rings). zones.py bbox COST logic UNCHANGED (still
          Med/NorthSea/Baltic only) — purely the /zones map layer. verified /zones
          200 w/ 8 features, rings closed.
      (2) idle/anchor days: reused days_since_drydock as the single fouling driver,
          relabeled "Demirde Bekleme / Drydock'tan Gün", placed directly UNDER Yıl.
      (3) hull-cleaning advisory: when days_since_drydock > 25 (HULL_CLEAN_THRESHOLD)
          show TR note "⚠ Tekne kirliliği yüksek — gövde temizliği önerilir (yakıt
          verimliliği düşüyor)" under the input. display only.
      (4) moored vessel card: AIS navstat 1(anchor)/5(moored) or speed 0 -> instead
          of misleading "0 vs X", show "Gemi şu an demirde (0 kn). Seyir halinde
          olsaydı PRUVA önerisi: X kn." underway (speed>0) keeps the real 2-box
          comparison + diff note. VesselData +nav_status.
      backend touched = zones.geojson only (no endpoint/schema/formula) -> verified
      /zones via TestClient (no live vessel call). npm run build OK. bundle 203kB.
- [x] DEBUG F9d — vessel request_error was MISATTRIBUTED. DONE (1 live call). build OK.
      DIAGNOSED (1 masked live call): GET /vesselslist?userkey=WS…90&format=json&
        extradata=master -> HTTP 200, VALID list of 5 vessels. Endpoint intact,
        parsing fine — NO regression. Real causes: (a) the account's live fleet
        does NOT contain 9359600 (returns FT STURLA 9447287 / TIGRIS A 9443841 /
        SCOT AUGSBURG 9378022 / +2), so 9359600 is a fleet miss; (b) the 1h rate
        guard REPLAYED a stale _last_reason from an earlier transient failure for a
        full hour, and a fleet-miss within the hour got the "rate_limited"/
        catch-all instead of an honest reason.
      FIX (vessels.py, no endpoint/parse change): (1) guard interval now depends on
        outcome — SUCCESS held 1h (cached), FAILURE only _FAIL_COOLDOWN_S=300s so a
        transient error self-heals instead of poisoning the hour; when blocked it
        returns _last_reason VERBATIM (None on success) — no synthesized reason.
        (2) fetch_vessel: reason None + cache miss => "not_in_fleet" (distinct from
        the catch-all). frontend VESSEL_REASON_TR +not_in_fleet ("Bu gemi hesabın
        canlı filo listesinde değil").
      VERIFIED offline (0 live calls): fleet w/o 9359600 -> 9359600 not_in_fleet
        (stable on repeat, NOT rate_limited), 9447287 available (FT STURLA, moored
        0.0kn -> moored card), 9378022 available 12.4kn; transient fail -> replays
        within cooldown then self-heals to available after it. test_api.py
        test_vessel_parsing_offline +not_in_fleet case. in-fleet IMOs (9447287/
        9443841/9378022) work live; 9359600/9311646 honestly report not_in_fleet.
- [x] Vessel dropdown -> actual account fleet only. DONE. build OK. no live call.
      VESSELS now = the 3 real fleet vessels w/ real names: 9447287 FT STURLA,
        9443841 TIGRIS A, 9378022 SCOT AUGSBURG. removed 9359600/9311646 (not in
        account fleet -> would only ever return not_in_fleet). a successful query
        still refreshes each name from live AIS/MASTERDATA. /vessels (static) now
        returns these 3; /vessels/{imo} 404s for the removed IMOs.
      tests updated: test_vessels len 5->3 + IMO set {9447287,9443841,9378022};
        test_vessels_no_key_fallback uses in-fleet 9447287 (removed IMO would 404
        before the key check). verified static /vessels + 404 + offline tests
        green WITHOUT a live call. npm run build OK. bundle 203kB.
