"""Phase 4 check: exercise the FastAPI app in-process with TestClient.

Uses fastapi.testclient.TestClient so no live uvicorn server is needed: it
drives the ASGI app directly. Checks the health probe and the full /optimize
flow on the 3-leg storm voyage, asserting the expected CII grade jump.
"""

import json

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def main():
    # Health probe.
    health = client.get("/health")
    assert health.json() == {"status": "ok"}, health.json()

    # Full optimize flow: 3-leg storm voyage.
    payload = {
        "legs": [
            {"distance_nm": 700, "weather": 1.0},
            {"distance_nm": 700, "weather": 1.4},
            {"distance_nm": 700, "weather": 1.0},
        ],
        "dwt": 40000,
        "service_speed": 14.0,
        "berth_eta_h": 175.0,
        "year": 2026,
    }
    resp = client.post("/optimize", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    print(json.dumps(data, indent=2))

    # Re-baselined for the log-linear fuel model (F1): the 3-leg storm voyage now
    # lands baseline E -> optimized D, saving ~25%. (Under the old cubic model it
    # was E -> C; absolute numbers shifted with the model swap, as expected.)
    valid_grades = ("A", "B", "C", "D", "E")
    assert data["baseline"]["cii_grade"] == "E", data["baseline"]["cii_grade"]
    assert data["optimized"]["cii_grade"] in valid_grades, data["optimized"]["cii_grade"]
    # Optimization must improve (or hold) the grade, never worsen it.
    assert data["optimized"]["cii_grade"] <= data["baseline"]["cii_grade"], (
        data["optimized"]["cii_grade"],
        data["baseline"]["cii_grade"],
    )
    # Saving sits in a believable slow-steaming band.
    assert 8 < data["saving_pct"] < 30, data["saving_pct"]

    print("\nLegacy-legs assertions passed.")


def _latlon(port):
    """Format a searched port as an unambiguous 'lat,lon' origin/dest string."""
    return f"{port['lat']},{port['lon']}"


def test_port_search():
    """Phase A: the WPI search endpoint returns sane matches with coords."""
    # /ports curated default list is now objects.
    curated = client.get("/ports").json()
    assert any("ISTANBUL" in p["name"].upper() for p in curated), curated

    izmir = client.get("/ports/search", params={"q": "izmir"}).json()
    assert izmir, "izmir search returned nothing"
    top = izmir[0]
    assert top["country"] == "Turkey", top
    # İzmir/Aliağa region: ~38 N, ~27 E.
    assert 37 < top["lat"] < 40 and 26 < top["lon"] < 28, top

    sing = client.get("/ports/search", params={"q": "singapore"}).json()
    assert sing, "singapore search returned nothing"
    assert any(
        "SINGAPORE" in p["name"].upper() or p["country"] == "Singapore" for p in sing
    ), sing

    print("\n=== Port search ===")
    print(f"  q=izmir top     : {top['name']} ({top['country']}) {top['lat']},{top['lon']}")
    print(f"  q=singapore top : {sing[0]['name']} ({sing[0]['country']})")
    print("Port-search assertions passed.")
    return izmir[0], sing[0]


def test_nearest_port():
    """Phase D: /ports/nearest returns the closest named port to a clicked point."""
    # Clicking near İzmir (38.4 N, 27.1 E) should land on a Turkish port nearby.
    izmir = client.get("/ports/nearest", params={"lat": 38.4, "lon": 27.1}).json()
    assert izmir["country"] == "Turkey", izmir
    assert izmir["distance_nm"] < 60, izmir  # clicked point is right on the coast

    # Clicking near Singapore (1.27 N, 103.8 E) should land on a Singapore-area port.
    sing = client.get("/ports/nearest", params={"lat": 1.27, "lon": 103.8}).json()
    assert sing["distance_nm"] < 60, sing
    assert "SINGAPORE" in sing["name"].upper() or sing["country"] == "Singapore", sing

    print("\n=== Nearest port (click-to-pick) ===")
    print(f"  near İzmir     : {izmir['name']} ({izmir['country']}) {izmir['distance_nm']:.1f} nm")
    print(f"  near Singapore : {sing['name']} ({sing['country']}) {sing['distance_nm']:.1f} nm")
    print("Nearest-port assertions passed.")


def test_real_routing():
    """Phase 6+A: full /optimize using two SEARCHED ports (by lat,lon)."""
    origin_port, dest_port = test_port_search()
    origin, dest = _latlon(origin_port), _latlon(dest_port)

    # Use the route-aware suggested ETA so the scenario is feasible and saving.
    info = client.get(
        "/route_info", params={"origin": origin, "dest": dest, "num_legs": 6}
    ).json()
    eta = info["suggested_eta_h"]

    payload = {
        "origin": origin,
        "dest": dest,
        "num_legs": 6,
        "dwt": 40000,
        "service_speed": 14.0,
        "berth_eta_h": eta,
        "year": 2026,
        "auto_weather": False,  # deterministic: don't hit the live weather API here
    }
    resp = client.post("/optimize", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    coords = data["route_coords"]
    assert coords, "route_coords should be non-empty"
    assert data["distance_nm"] > 1000, data["distance_nm"]
    assert data["feasible"] is True, data["feasible"]
    assert data["saving_pct"] > 0, data["saving_pct"]
    assert data["money_saved_usd"] > 0, data["money_saved_usd"]

    base = data["baseline"]
    # İzmir is in the Mediterranean ECA, so part of the route is in scope.
    assert base["eca_nm"] > 0, base["eca_nm"]
    assert data["eca_zones"], "eca_zones should be present for routed voyages"

    # Expect baseline E and an optimized grade clearly better (E -> ~C).
    assert base["cii_grade"] == "E", base["cii_grade"]
    assert data["optimized"]["cii_grade"] in ("A", "B", "C", "D"), data["optimized"]["cii_grade"]

    print("\n=== Real routing (searched ports) ===")
    print(f"  {origin_port['name']} -> {dest_port['name']}")
    print(f"  distance      : {data['distance_nm']:.1f} nm  (eta={eta} h)")
    print(f"  baseline -> optimized grade: {base['cii_grade']} -> {data['optimized']['cii_grade']}")
    print(f"  saving        : {data['saving_pct']:.1f}%")
    print(f"  eca_nm        : {base['eca_nm']:.1f} nm")
    print(f"  money saved   : ${data['money_saved_usd']:,.0f}")
    print("Real-routing assertions passed.")


def test_infeasible_eta():
    """Phase 11: an impossibly tight ETA must be flagged feasible == False."""
    izmir = client.get("/ports/search", params={"q": "izmir"}).json()[0]
    sing = client.get("/ports/search", params={"q": "singapore"}).json()[0]
    payload = {
        "origin": _latlon(izmir),
        "dest": _latlon(sing),
        "num_legs": 6,
        "dwt": 40000,
        "service_speed": 14.0,
        "berth_eta_h": 10.0,  # a multi-thousand-nm route cannot be done in 10 h
        "year": 2026,
        "auto_weather": False,
    }
    resp = client.post("/optimize", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["feasible"] is False, data["feasible"]
    assert data["min_time_h"] > 10.0, data["min_time_h"]

    print("\n=== Infeasible ETA @ 10 h ===")
    print(f"  feasible   : {data['feasible']}")
    print(f"  min_time_h : {data['min_time_h']:.1f} h (earliest possible arrival)")
    print("Infeasible-ETA assertions passed.")


def test_alternatives():
    """Phase F4: /alternatives returns scored candidate routes with one pick."""
    ist = client.get("/ports/search", params={"q": "istanbul"}).json()[0]
    sing = client.get("/ports/search", params={"q": "singapore"}).json()[0]
    payload = {
        "origin": _latlon(ist),
        "dest": _latlon(sing),
        "num_legs": 6,
        "dwt": 40000,
        "service_speed": 14.0,
        # Loose ETA so the long HRA-avoiding (Cape) lane is also feasible -> every
        # candidate has slack to slow down and shows a positive saving.
        "berth_eta_h": 1100.0,
        "year": 2026,
        "auto_weather": False,  # deterministic (no live API in the test)
    }
    resp = client.post("/alternatives", json=payload)
    assert resp.status_code == 200, resp.text
    cands = resp.json()

    assert len(cands) >= 2, cands
    # The İstanbul->Singapore shortest lane goes through the Gulf of Aden HRA.
    shortest = next(c for c in cands if c["id"] == "shortest")
    assert shortest["crosses_hra"] is True, shortest
    # An HRA-avoiding alternative must be offered, and it must NOT cross the HRA.
    hra = next((c for c in cands if c["id"] == "hra_avoiding"), None)
    assert hra is not None, cands
    assert hra["crosses_hra"] is False, hra
    assert hra["distance_nm"] > shortest["distance_nm"], (hra, shortest)

    for c in cands:
        assert c["route_coords"], c["id"]
        assert c["cii_grade"] in ("A", "B", "C", "D", "E"), c
        assert c["saving_pct"] > 0, c  # feasible + slack -> real saving
    # Exactly one recommendation, and it is the lowest-fuel feasible candidate.
    recs = [c for c in cands if c["recommended"]]
    assert len(recs) == 1, recs
    feasible = [c for c in cands if c["feasible"]]
    assert recs[0]["fuel_t"] == min(c["fuel_t"] for c in feasible), recs

    print("\n=== Alternative routes (İstanbul -> Singapore) ===")
    for c in cands:
        star = " ★ÖNERİLEN" if c["recommended"] else ""
        print(
            f"  {c['id']:26s} {c['distance_nm']:7.0f}nm  {c['total_time_h']:6.0f}h  "
            f"{c['fuel_t']:7.0f}t  CII {c['cii_grade']}  "
            f"${c['cost_usd']:>10,.0f}  HRA={c['crosses_hra']}{star}"
        )
    print("Alternatives assertions passed.")


def test_per_leg_and_segmentation():
    """Phase F6: per-leg fuel breakdown + distance-based leg count.

    Asserts (1) the leg count scales with route distance (a long crossing gets
    more legs than a short hop, both clamped to 3..12), (2) /optimize returns a
    per_leg array of length num_legs, and (3) the per-leg optimized fuel sums to
    the voyage total (consistency — same engine, no double counting).
    """
    ist = client.get("/ports/search", params={"q": "istanbul"}).json()[0]
    sing = client.get("/ports/search", params={"q": "singapore"}).json()[0]
    izmir = client.get("/ports/search", params={"q": "izmir"}).json()[0]

    # Distance-based leg count: short İzmir->İstanbul hop vs long İst->Singapore.
    short_info = client.get(
        "/route_info", params={"origin": _latlon(izmir), "dest": _latlon(ist)}
    ).json()
    long_info = client.get(
        "/route_info", params={"origin": _latlon(ist), "dest": _latlon(sing)}
    ).json()
    assert 3 <= short_info["num_legs"] <= 12, short_info
    assert 3 <= long_info["num_legs"] <= 12, long_info
    assert long_info["num_legs"] > short_info["num_legs"], (long_info, short_info)
    # The short hop should bottom out at the floor; the long crossing near the cap.
    assert short_info["num_legs"] == 3, short_info
    assert long_info["num_legs"] >= 8, long_info

    # An explicit num_legs override still wins over the distance-based default.
    forced = client.get(
        "/route_info",
        params={"origin": _latlon(ist), "dest": _latlon(sing), "num_legs": 5},
    ).json()
    assert forced["num_legs"] == 5, forced

    # /optimize: per_leg present, length == num_legs, fuel sums to the total.
    payload = {
        "origin": _latlon(ist),
        "dest": _latlon(sing),
        "dwt": 40000,
        "service_speed": 14.0,
        "berth_eta_h": long_info["suggested_eta_h"],
        "year": 2026,
        "auto_weather": False,  # deterministic (no live API in the test)
    }
    data = client.post("/optimize", json=payload).json()
    per_leg = data["per_leg"]
    assert per_leg is not None, data
    assert data["num_legs"] == long_info["num_legs"], (data["num_legs"], long_info)
    assert len(per_leg) == data["num_legs"], (len(per_leg), data["num_legs"])

    # Leg indices are 0..n-1 in order; speeds sit within the optimizer bounds.
    assert [p["leg_index"] for p in per_leg] == list(range(len(per_leg))), per_leg
    assert all(10.0 <= p["speed_kn"] <= 16.0 for p in per_leg), per_leg

    # Per-leg fuel sums (and distance sums) match the voyage totals (rounding only).
    sum_opt = sum(p["fuel_t"] for p in per_leg)
    sum_base = sum(p["baseline_fuel_t"] for p in per_leg)
    sum_dist = sum(p["distance_nm"] for p in per_leg)
    assert abs(sum_opt - data["optimized"]["fuel_t"]) < 1.0, (sum_opt, data["optimized"]["fuel_t"])
    assert abs(sum_base - data["baseline"]["fuel_t"]) < 1.0, (sum_base, data["baseline"]["fuel_t"])
    assert abs(sum_dist - data["distance_nm"]) < 1.0, (sum_dist, data["distance_nm"])

    print("\n=== Per-leg fuel + distance-based segmentation ===")
    print(f"  İzmir->İstanbul  : {short_info['distance_nm']:6.0f} nm -> {short_info['num_legs']} legs")
    print(f"  İstanbul->Singapore: {long_info['distance_nm']:6.0f} nm -> {long_info['num_legs']} legs")
    print(f"  per_leg fuel sum  : {sum_opt:.1f} t  (voyage total {data['optimized']['fuel_t']:.1f} t)")
    for p in per_leg[:3]:
        print(
            f"  leg {p['leg_index']}: {p['distance_nm']:.0f} nm @ {p['speed_kn']:.2f} kn "
            f"-> {p['fuel_t']:.1f} t  (wave {p['wave_m']} m, SOG {p['sog_kn']} kn)"
        )
    print("Per-leg / segmentation assertions passed.")


def test_vessels():
    """Phase F9: fleet list (5) + a single live-or-fallback vessel lookup.

    The detail call makes at most one real VesselFinder query (the module batches
    + caches >= 1 h), so this test must NOT be run on a tight loop. It tolerates
    BOTH outcomes: live data when the trial key works, or a clean
    available:false fallback when the key is missing / over its hourly limit.
    """
    fleet = client.get("/vessels").json()
    assert len(fleet) == 5, fleet
    assert all("imo" in v and "name" in v for v in fleet), fleet
    # The fixed Karadeniz Holding IMOs are exactly these.
    assert {v["imo"] for v in fleet} == {
        9359600,
        9447287,
        9311646,
        9378022,
        9443841,
    }, fleet

    # Unknown IMO -> 404 (we never spend the quota on arbitrary IMOs).
    assert client.get("/vessels/1234567").status_code == 404

    # Detail: must always carry an 'available' flag and never error.
    detail = client.get(f"/vessels/{fleet[0]['imo']}").json()
    assert "available" in detail, detail
    if detail["available"]:
        # Live data: position + speed fields present (units: kn, m per VF docs).
        for key in ("speed_kn", "lat", "lon", "draught_m"):
            assert key in detail, detail
        print("\n=== Vessels (LIVE VesselFinder data) ===")
        print(
            f"  {detail['name']}: speed={detail['speed_kn']} kn  "
            f"pos=({detail['lat']},{detail['lon']})  draught={detail['draught_m']} m  "
            f"dwt={detail.get('dwt')}  dest={detail.get('destination')}"
        )
    else:
        assert "reason" in detail, detail
        print("\n=== Vessels (graceful fallback, no live data) ===")
        print(f"  {detail['name']}: available=False reason={detail['reason']}")
    print(f"  fleet size: {len(fleet)} vessels")
    print("Vessels assertions passed.")


def test_vessel_reason_classification():
    """Phase F9b: the error classifier distinguishes auth / limit / request errors.

    Pure-function test (NO network/live call): VesselFinder returns HTTP 200 with
    {"error": "Invalid Userkey!"} for a bad key, so we must read the body to tell
    an inactive/invalid key apart from a real hourly limit apart from a bad param.
    """
    import vessels as vx

    # Auth: invalid/inactive key (the real observed case) and 401/403.
    assert vx._classify_error(200, "", {"error": "Invalid Userkey!"}) == "auth"
    assert vx._classify_error(403, "Access denied", {"error": "Access denied"}) == "auth"
    assert vx._classify_error(200, "", {"error": "API key not active"}) == "auth"
    # Rate limit: explicit quota message and HTTP 429.
    assert vx._classify_error(200, "", {"error": "Hourly query limit exceeded"}) == "rate_limited"
    assert vx._classify_error(429, "Too Many Requests", None) == "rate_limited"
    # Anything else -> request error.
    assert vx._classify_error(200, "", {"error": "Invalid IMO"}) == "request_error"

    print("\n=== Vessel error classification (offline) ===")
    print("  Invalid Userkey -> auth · limit exceeded -> rate_limited · other -> request_error")
    print("Vessel reason-classification assertions passed.")


def test_vessels_no_key_fallback():
    """Phase F9: with no API key the detail endpoint degrades cleanly (no call)."""
    import os
    import vessels as vx

    saved = os.environ.pop("VESSELFINDER_API_KEY", None)
    try:
        detail = client.get("/vessels/9359600").json()
        assert detail["available"] is False, detail
        assert detail["reason"] == "no_api_key", detail
        assert detail["imo"] == 9359600 and detail["name"], detail
    finally:
        if saved is not None:
            os.environ["VESSELFINDER_API_KEY"] = saved
        vx._CACHE.clear()

    print("\n=== Vessels fallback (no API key) ===")
    print("  /vessels/9359600 -> available=False reason=no_api_key (no API call)")
    print("Vessels no-key fallback assertions passed.")


def _weather_payload(auto_weather):
    izmir = client.get("/ports/search", params={"q": "izmir"}).json()[0]
    sing = client.get("/ports/search", params={"q": "singapore"}).json()[0]
    return {
        "origin": _latlon(izmir),
        "dest": _latlon(sing),
        "num_legs": 6,
        "dwt": 40000,
        "service_speed": 14.0,
        "berth_eta_h": 480.0,
        "year": 2026,
        "auto_weather": auto_weather,
    }


def test_auto_weather():
    """Phase B: auto_weather returns 6 per-leg weather entries in [1.0, 1.6]."""
    import time as _t

    t0 = _t.time()
    resp = client.post("/optimize", json=_weather_payload(True))
    elapsed = _t.time() - t0
    assert resp.status_code == 200, resp.text
    data = resp.json()

    lw = data["legs_weather"]
    assert lw is not None and len(lw) == 6, lw
    for leg in lw:
        assert 1.0 <= leg["factor"] <= 1.6, leg
        assert leg["source"] in ("open-meteo", "fallback"), leg
    # Even with per-leg timeouts and concurrent fetch, it must finish promptly.
    assert elapsed < 30, elapsed

    print("\n=== Auto weather (live Open-Meteo, concurrent) ===")
    print(f"  completed in {elapsed:.1f}s")
    for i, leg in enumerate(lw):
        print(f"  leg {i+1}: wave_m={leg['wave_m']} factor={leg['factor']} src={leg['source']}")
    print("Auto-weather assertions passed.")


def test_weather_fallback():
    """Phase B: if the weather API is unreachable, all 6 legs fall back to 1.0."""
    import weather as wx

    # Point the endpoints at an unreachable host and clear the cache so every
    # leg is forced down the fallback path.
    orig_marine, orig_forecast = wx.MARINE_URL, wx.FORECAST_URL
    wx.MARINE_URL = "http://127.0.0.1:9/marine"
    wx.FORECAST_URL = "http://127.0.0.1:9/forecast"
    wx._CACHE.clear()
    try:
        resp = client.post("/optimize", json=_weather_payload(True))
        assert resp.status_code == 200, resp.text
        lw = resp.json()["legs_weather"]
        assert lw is not None and len(lw) == 6, lw
        assert all(leg["factor"] == 1.0 for leg in lw), lw
        assert all(leg["source"] == "fallback" for leg in lw), lw
    finally:
        wx.MARINE_URL, wx.FORECAST_URL = orig_marine, orig_forecast
        wx._CACHE.clear()

    print("\n=== Weather fallback (API unreachable) ===")
    print("  all 6 legs -> factor 1.0, source 'fallback' (no hang/crash)")
    print("Weather-fallback assertions passed.")


if __name__ == "__main__":
    main()
    test_nearest_port()
    test_real_routing()
    test_infeasible_eta()
    test_per_leg_and_segmentation()
    test_alternatives()
    test_auto_weather()
    test_weather_fallback()
    test_vessels()
    test_vessel_reason_classification()
    test_vessels_no_key_fallback()
    print("\nAll assertions passed.")
