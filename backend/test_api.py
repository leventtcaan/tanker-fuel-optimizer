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

    assert data["baseline"]["cii_grade"] == "E", data["baseline"]["cii_grade"]
    assert data["optimized"]["cii_grade"] == "C", data["optimized"]["cii_grade"]
    assert data["saving_pct"] > 25, data["saving_pct"]

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


if __name__ == "__main__":
    main()
    test_real_routing()
    test_infeasible_eta()
    print("\nAll assertions passed.")
