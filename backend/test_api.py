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

    print("\nAll assertions passed.")


if __name__ == "__main__":
    main()
