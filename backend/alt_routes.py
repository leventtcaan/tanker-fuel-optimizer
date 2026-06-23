"""Alternative-route generation: produce a few candidate lanes to compare.

A captain rarely has a single option. This module generates 2-4 candidate sea
routes between the same origin and destination so the optimizer can score each
(fuel / time / CII / cost / risk) and recommend one.

Three kinds of candidate (see _reference/PLAN.md F4 probe):

  - "shortest"                  : searoute's default lane (real).
  - "hra_avoiding"              : a passage-restricted lane that stays out of the
                                  piracy High-Risk Area, produced with searoute's
                                  real `restrictions` mechanism (genuinely a
                                  different line). Only offered when the shortest
                                  route actually crosses the HRA polygon.
  - "weather_current_optimized" : a WAYPOINT-NUDGE around the single worst
                                  wave+head-current leg. searoute does not take
                                  arbitrary waypoints, so we route origin->wp and
                                  wp->dest and stitch the two real legs together.
                                  This is an APPROXIMATION (a perpendicular nudge,
                                  not true weather-graph routing) and is disclosed
                                  as such in AUDIT.md. Only offered when live
                                  weather/current data identifies a worst leg.

This module only builds GEOMETRY + metadata; the scoring (weather, optimizer,
CII, cost) is done by the caller (main.py), reusing the existing engine.
"""

import json
import math
import os

from routing import get_sea_route, _haversine_nm

# Passages to block so the lane avoids the Red Sea / Gulf of Aden HRA entirely,
# forcing the Cape-of-Good-Hope routing. "northwest" is kept because it is
# searoute's own default restriction.
HRA_AVOID_RESTRICTIONS = ["suez", "babalmandab", "northwest"]

_ZONES_PATH = os.path.join(os.path.dirname(__file__), "data", "zones.geojson")


def _load_hra_rings():
    """Load HRA polygon outer rings from the bundled zones GeoJSON (once).

    Returns a list of rings, each a list of (lon, lat) vertices.
    """
    with open(_ZONES_PATH, encoding="utf-8") as f:
        fc = json.load(f)
    rings = []
    for feature in fc.get("features", []):
        if feature.get("properties", {}).get("type") == "HRA":
            rings.append(feature["geometry"]["coordinates"][0])
    return rings


_HRA_RINGS = _load_hra_rings()


def _point_in_ring(lon, lat, ring):
    """Ray-casting point-in-polygon test. `ring` vertices are (lon, lat)."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def crosses_hra(coords_latlon):
    """True if any [lat, lon] point on the route falls inside an HRA polygon."""
    for lat, lon in coords_latlon:
        for ring in _HRA_RINGS:
            if _point_in_ring(lon, lat, ring):
                return True
    return False


def worst_leg_index(legs_weather):
    """Index of the leg with the heaviest wave + head-current penalty.

    Combines the wave-derived weather factor with any head-current component
    (a negative along-track current makes a leg slower/costlier). Returns None if
    nothing stands out (no live data, or everything calm).

    Args:
        legs_weather: per-leg dicts from the weather fetch, optionally carrying a
            "current_along_kn" the caller has computed (signed: + following).
    """
    best_idx = None
    best_score = 0.0
    for i, lw in enumerate(legs_weather or []):
        factor = lw.get("factor", 1.0) or 1.0
        along = lw.get("current_along_kn", 0.0) or 0.0
        head_penalty = max(0.0, -along)  # only a head current hurts
        score = (factor - 1.0) + 0.1 * head_penalty
        if score > best_score:
            best_score = score
            best_idx = i
    return best_idx


def _midpoint_and_bearing(coords_latlon, idx, k):
    """Midpoint [lat, lon] and heading of leg `idx` of k, on the polyline."""
    n_seg = len(coords_latlon) - 1
    start = idx * n_seg // k
    end = (idx + 1) * n_seg // k
    mid = min((start + end) // 2, len(coords_latlon) - 1)
    p0 = coords_latlon[start]
    p1 = coords_latlon[min(end, len(coords_latlon) - 1)]
    bearing = math.atan2(
        math.cos(math.radians(p1[0])) * math.sin(math.radians(p1[1] - p0[1])),
        math.cos(math.radians(p0[0])) * math.sin(math.radians(p1[0]))
        - math.sin(math.radians(p0[0]))
        * math.cos(math.radians(p1[0]))
        * math.cos(math.radians(p1[1] - p0[1])),
    )
    return coords_latlon[mid], math.degrees(bearing)


def hra_avoiding_route(origin_ll, dest_ll):
    """Real passage-restricted lane that avoids the HRA. None if it fails.

    Returns {coords_latlon, distance_nm} like get_sea_route, or None if searoute
    cannot produce a route under the restrictions.
    """
    try:
        route = get_sea_route(origin_ll, dest_ll, restrictions=HRA_AVOID_RESTRICTIONS)
    except Exception:
        return None
    if not route["coords_latlon"]:
        return None
    return route


def weather_current_route(origin_ll, dest_ll, shortest_coords, worst_idx, num_legs):
    """Waypoint-nudge lane around the worst leg. None if it isn't worthwhile.

    Offsets the worst leg's midpoint ~1.5 degrees perpendicular to its heading,
    routes origin -> waypoint -> dest, and stitches the two real sea legs. Returns
    None if routing fails or the result is not meaningfully different from the
    shortest lane (so we never present a duplicate as an "alternative").

    APPROXIMATION (disclosed): a single perpendicular nudge, not true
    weather-aware graph routing.
    """
    if worst_idx is None:
        return None

    mid, bearing = _midpoint_and_bearing(shortest_coords, worst_idx, num_legs)
    offset_deg = 1.5
    # Perpendicular to the heading (bearing + 90 deg), in lat/lon degrees.
    perp = math.radians(bearing + 90.0)
    wp_lat = mid[0] + offset_deg * math.cos(perp)
    wp_lon = mid[1] + offset_deg * math.sin(perp)

    try:
        leg1 = get_sea_route(origin_ll, (wp_lat, wp_lon))
        leg2 = get_sea_route((wp_lat, wp_lon), dest_ll)
    except Exception:
        return None
    if not leg1["coords_latlon"] or not leg2["coords_latlon"]:
        return None

    coords = leg1["coords_latlon"] + leg2["coords_latlon"][1:]
    distance = leg1["distance_nm"] + leg2["distance_nm"]

    shortest_dist = sum(
        _haversine_nm(
            shortest_coords[i][0],
            shortest_coords[i][1],
            shortest_coords[i + 1][0],
            shortest_coords[i + 1][1],
        )
        for i in range(len(shortest_coords) - 1)
    )
    # Require a meaningful (>2%) deviation, otherwise it's effectively the shortest.
    if shortest_dist > 0 and abs(distance - shortest_dist) / shortest_dist < 0.02:
        return None

    return {"coords_latlon": coords, "distance_nm": distance}
