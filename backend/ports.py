"""World port database, loaded from the bundled NGA World Port Index dataset.

ENGINEERING NOTE: the dataset (backend/data/ports.json, NGA Pub 150 / World Port
Index) is COMMITTED into the repo and loaded ONCE here at module import into an
in-memory list. Bundling it (rather than downloading at runtime) means the demo
works offline and has no external-uptime dependency; loading once (not per
request) keeps search fast.

The file has 5,410 records; 3,630 of them carry a port name (the other 1,780 are
location-only with no name). Only the named ports are indexed, since you cannot
search or display a nameless port. Every record has WGS84 lat/lon.
"""

import json
import math
import os

_DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "ports.json")

# Earth's mean radius in nautical miles (same constant as routing.py), used by
# nearest_port to rank ports by great-circle distance from a clicked point.
_EARTH_RADIUS_NM = 3440.065

# Rank port_size categories so larger ports surface first in search results.
_SIZE_RANK = {"Major": 0, "Minor": 1, "Small": 2, "Very Small": 3}


def _load_ports():
    """Load and normalize named ports from the bundled WPI dataset (once)."""
    with open(_DATA_PATH, encoding="utf-8") as f:
        raw = json.load(f)

    ports = []
    for p in raw["ports"]:
        name = p.get("wpi_port_name")
        lat = p.get("latitude")
        lon = p.get("longitude")
        if not name or lat is None or lon is None:
            continue  # skip the location-only (nameless) records
        country = p.get("country") or ""
        ports.append(
            {
                "id": p.get("wpi_port_id"),
                "name": name,
                "country": country,
                "lat": float(lat),
                "lon": float(lon),
                "port_size": p.get("port_size"),
                # precomputed lowercased fields for case-insensitive search
                "_name_l": name.lower(),
                "_search": f"{name} {country}".lower(),
            }
        )
    return ports


# In-memory index, built once at import.
PORTS = _load_ports()
_BY_NAME = {p["_name_l"]: p for p in PORTS}

# Curated default list for the initial UI (real dataset names).
_CURATED_NAMES = [
    "ISTANBUL",
    "ALIAGA",
    "IZMIR",
    "KEPPEL - (EAST SINGAPORE)",
    "ROTTERDAM",
    "FUJAYRAH HARBOR",
]


def _public(p):
    """Strip internal search fields for an API-facing port record."""
    return {
        "id": p["id"],
        "name": p["name"],
        "country": p["country"],
        "lat": p["lat"],
        "lon": p["lon"],
    }


def _size_rank(p):
    return _SIZE_RANK.get(p.get("port_size"), 4)


def search_ports(q, limit=20):
    """Search ports by name or country, case-insensitive.

    Match rank (best first): exact name, name prefix, name substring, then
    country/other substring. Ties broken by port size (larger first), then name.
    """
    ql = q.strip().lower()
    if not ql:
        return []

    matches = []
    for p in PORTS:
        if ql not in p["_search"]:
            continue
        nl = p["_name_l"]
        if nl == ql:
            rank = 0
        elif nl.startswith(ql):
            rank = 1
        elif ql in nl:
            rank = 2
        else:
            rank = 3  # matched on country only
        matches.append((rank, _size_rank(p), p["name"], p))

    matches.sort(key=lambda t: (t[0], t[1], t[2]))
    return [_public(p) for _, _, _, p in matches[:limit]]


def curated_ports():
    """Small curated default list for the initial UI (those present in the data)."""
    out = []
    for nm in _CURATED_NAMES:
        p = _BY_NAME.get(nm.lower())
        if p:
            out.append(_public(p))
    return out


def port_by_name(name):
    """Resolve a known port name to (lat, lon), or None if not found."""
    p = _BY_NAME.get(name.strip().lower())
    return (p["lat"], p["lon"]) if p else None


def _haversine_nm(lat1, lon1, lat2, lon2):
    """Great-circle distance between two [lat, lon] points, in nautical miles.

    Self-contained here (mirrors routing._haversine_nm) so ports.py stays free of
    the heavy searoute import that routing.py pulls in.
    """
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return _EARTH_RADIUS_NM * c


def nearest_port(lat, lon):
    """Return the closest NAMED port to a [lat, lon] point by haversine distance.

    Brute-force scan over the in-memory named-port list (~3,630 entries). That is
    a sub-millisecond linear pass; a k-d tree / spatial index would be premature
    optimization for a list this small and a query this infrequent (one click).

    Returns a public port record plus distance_nm, or None if no ports loaded.
    """
    best = None
    best_dist = None
    for p in PORTS:
        d = _haversine_nm(lat, lon, p["lat"], p["lon"])
        if best_dist is None or d < best_dist:
            best_dist = d
            best = p
    if best is None:
        return None
    out = _public(best)
    out["distance_nm"] = best_dist
    return out


def resolve_latlon(ref):
    """Resolve a port reference to (lat, lon).

    Accepts either a 'lat,lon' string (preferred — unambiguous, since 70 port
    names are duplicated across the world) or a known port name. Returns None if
    it cannot be resolved.
    """
    ref = ref.strip()
    if "," in ref:
        a, _, b = ref.partition(",")
        try:
            return (float(a), float(b))
        except ValueError:
            pass  # not coords -> fall through to name lookup
    return port_by_name(ref)
