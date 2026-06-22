"""Emission Control Areas (ECA / SECA) and where a route crosses them.

Inside an ECA a ship must burn very low sulphur fuel (<= 0.1% S), which costs
more than open-sea fuel. To price a voyage we need to know how much of it runs
inside an ECA.

YAGNI: the real IMO ECAs are exact polygons; here we approximate each one with a
simple latitude/longitude bounding box. This is deliberately coarse — good enough
to attribute route distance to ECA vs open sea, not a navigational boundary.
"""

import math

# Earth's mean radius in nautical miles, for great-circle segment lengths.
EARTH_RADIUS_NM = 3440.065

# Approximate ECA bounding boxes (lat_min, lat_max, lon_min, lon_max).
# NOTE: simplified rectangles, NOT the exact IMO ECA polygons.
ECA_ZONES = [
    {
        # Mediterranean Sea ECA — in force since 2025-05-01.
        "name": "Mediterranean ECA",
        "bbox": (30.0, 46.0, -6.0, 36.5),
    },
    {
        "name": "North Sea ECA",
        "bbox": (51.0, 62.0, -4.0, 12.0),
    },
    {
        "name": "Baltic Sea ECA",
        "bbox": (53.0, 66.0, 9.0, 30.0),
    },
]


def point_in_eca(lat, lon):
    """Return True if the point falls inside any approximate ECA box."""
    for zone in ECA_ZONES:
        lat_min, lat_max, lon_min, lon_max = zone["bbox"]
        if lat_min <= lat <= lat_max and lon_min <= lon <= lon_max:
            return True
    return False


def _haversine_nm(lat1, lon1, lat2, lon2):
    """Great-circle distance between two [lat, lon] points, in nautical miles."""
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return EARTH_RADIUS_NM * c


def eca_split(coords_latlon):
    """Split a route polyline into nautical miles inside vs outside an ECA.

    Walks each consecutive [lat, lon] segment, measures its haversine length, and
    attributes that whole length to ECA or non-ECA based on the segment midpoint.
    Midpoint attribution keeps it simple (no boundary clipping) at the cost of
    small error near ECA edges — acceptable given the bbox approximation.

    Args:
        coords_latlon: list of [lat, lon] points along the route.

    Returns:
        (eca_nm, non_eca_nm): distance inside ECAs and outside, in nautical miles.
    """
    eca_nm = 0.0
    non_eca_nm = 0.0
    for i in range(len(coords_latlon) - 1):
        lat1, lon1 = coords_latlon[i]
        lat2, lon2 = coords_latlon[i + 1]
        seg = _haversine_nm(lat1, lon1, lat2, lon2)
        mid_lat = (lat1 + lat2) / 2
        mid_lon = (lon1 + lon2) / 2
        if point_in_eca(mid_lat, mid_lon):
            eca_nm += seg
        else:
            non_eca_nm += seg
    return eca_nm, non_eca_nm
