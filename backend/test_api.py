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


def test_real_routing():
    """Phase 6: real port-to-port routing via /optimize with origin+dest."""
    # /ports should expose the dropdown options.
    ports = client.get("/ports").json()
    assert "İstanbul (Ambarlı)" in ports, ports
    assert "Singapore" in ports, ports

    # Istanbul -> Singapore is ~5858 nm. Baseline at 14 kn ~ 418 h; all-vmin
    # (10 kn) ~ 586 h. A 480 h budget binds the constraint so the optimizer
    # slows below service speed for a real saving.
    payload = {
        "origin": "İstanbul (Ambarlı)",
        "dest": "Singapore",
        "num_legs": 6,
        "dwt": 40000,
        "service_speed": 14.0,
        "berth_eta_h": 480.0,
        "year": 2026,
    }
    resp = client.post("/optimize", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    coords = data["route_coords"]
    assert coords, "route_coords should be non-empty"
    assert data["distance_nm"] > 5000, data["distance_nm"]
    assert data["saving_pct"] > 0, data["saving_pct"]

    # Phase 7 economics: optimized should cost less fuel, and money saved > 0.
    base_cost = data["baseline"]["fuel_cost_usd"]
    opt_cost = data["optimized"]["fuel_cost_usd"]
    assert opt_cost < base_cost, (opt_cost, base_cost)
    assert data["money_saved_usd"] > 0, data["money_saved_usd"]

    # Phase 8 ECA: the Med leg is an ECA, so eca_nm > 0; and blending in the
    # pricier ECA fuel must push the cost above the flat all-open-fuel cost.
    base = data["baseline"]
    assert base["eca_nm"] > 0, base["eca_nm"]
    assert base["blended_fuel_cost_usd"] > base["fuel_cost_usd"], (
        base["blended_fuel_cost_usd"],
        base["fuel_cost_usd"],
    )
    assert data["eca_zones"], "eca_zones should be present for routed voyages"

    # Phase 11: a normal ETA must be feasible.
    assert data["feasible"] is True, data["feasible"]
    assert data["min_time_h"] > 0, data["min_time_h"]

    print("\n=== Real routing: İstanbul (Ambarlı) -> Singapore ===")
    print(f"  distance      : {data['distance_nm']:.1f} nm")
    print(f"  route points  : {len(coords)}")
    print(f"  baseline grade: {data['baseline']['cii_grade']}")
    print(f"  optimized grade: {data['optimized']['cii_grade']}")
    print(f"  saving        : {data['saving_pct']:.1f}%")
    print(f"  eca_nm        : {base['eca_nm']:.1f} nm")
    print(f"  non_eca_nm    : {base['non_eca_nm']:.1f} nm")
    print(f"  baseline blended cost : ${base['blended_fuel_cost_usd']:,.0f}")
    print(f"  optimized blended cost: ${data['optimized']['blended_fuel_cost_usd']:,.0f}")
    print(f"  money saved (blended) : ${data['money_saved_usd']:,.0f}")
    print("Real-routing assertions passed.")


def test_infeasible_eta():
    """Phase 11: an impossibly tight ETA must be flagged feasible == False."""
    payload = {
        "origin": "İstanbul (Ambarlı)",
        "dest": "Singapore",
        "num_legs": 6,
        "dwt": 40000,
        "service_speed": 14.0,
        "berth_eta_h": 10.0,  # ~5858 nm cannot be sailed in 10 h
        "year": 2026,
    }
    resp = client.post("/optimize", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["feasible"] is False, data["feasible"]
    assert data["min_time_h"] > 10.0, data["min_time_h"]

    print("\n=== Infeasible ETA: İstanbul -> Singapore @ 10 h ===")
    print(f"  feasible   : {data['feasible']}")
    print(f"  min_time_h : {data['min_time_h']:.1f} h (earliest possible arrival)")
    print("Infeasible-ETA assertions passed.")


if __name__ == "__main__":
    main()
    test_real_routing()
    test_infeasible_eta()
    print("\nAll assertions passed.")
