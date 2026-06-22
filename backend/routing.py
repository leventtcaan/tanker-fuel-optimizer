"""Real sea routing: turn port coordinates into a navigable ocean lane.

Uses the `searoute` library, which routes over a global marine network (around
land, through the usual shipping lanes) rather than a naive great-circle line.

IMPORTANT coordinate convention: searoute speaks [lon, lat], but Leaflet and the
rest of this app speak [lat, lon]. This module takes/returns [lat, lon] and does
the swap internally so callers never have to think about it.
"""

import math

import searoute as sr

from voyage import Leg

# Earth's mean radius in nautical miles, for great-circle leg distances.
EARTH_RADIUS_NM = 3440.065


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


def get_sea_route(origin_latlon, dest_latlon):
    """Compute the real sea route between two [lat, lon] points.

    Calls searoute (which wants [lon, lat]) and converts the resulting polyline
    back to [lat, lon] for Leaflet. The distance is searoute's own lane length
    in nautical miles.

    Args:
        origin_latlon: (lat, lon) of the origin port.
        dest_latlon: (lat, lon) of the destination port.

    Returns:
        dict with:
            coords_latlon: list of [lat, lon] points along the sea lane.
            distance_nm: total lane length in nautical miles.
    """
    origin_lonlat = [origin_latlon[1], origin_latlon[0]]
    dest_lonlat = [dest_latlon[1], dest_latlon[0]]

    route = sr.searoute(origin_lonlat, dest_lonlat, units="naut")

    # searoute returns [lon, lat]; swap to [lat, lon] for Leaflet.
    coords_latlon = [[lat, lon] for lon, lat in route["geometry"]["coordinates"]]
    distance_nm = float(route["properties"]["length"])

    return {"coords_latlon": coords_latlon, "distance_nm": distance_nm}


def resample_to_legs(coords_latlon, k=6, weather=None):
    """Split a [lat, lon] polyline into k contiguous legs for the optimizer.

    The route polyline can have many points (~78); the optimizer works on a
    handful of legs. We divide the polyline's point-segments into k roughly equal
    contiguous chunks and sum the haversine distance within each chunk to get
    that leg's distance. Weather defaults to calm (1.0) for every leg.

    Args:
        coords_latlon: list of [lat, lon] points along the route.
        k: number of legs to produce.
        weather: optional list of k weather factors; default all 1.0.

    Returns:
        list of k Leg objects (distance_nm, weather), compatible with optimizer.
    """
    if weather is None:
        weather = [1.0] * k

    # Per-segment haversine distances between consecutive polyline points.
    seg_distances = [
        _haversine_nm(
            coords_latlon[i][0],
            coords_latlon[i][1],
            coords_latlon[i + 1][0],
            coords_latlon[i + 1][1],
        )
        for i in range(len(coords_latlon) - 1)
    ]

    n_segments = len(seg_distances)
    legs = []
    for leg_index in range(k):
        # Contiguous slice of segments belonging to this leg.
        start = leg_index * n_segments // k
        end = (leg_index + 1) * n_segments // k
        leg_distance = sum(seg_distances[start:end])
        leg_weather = weather[leg_index] if leg_index < len(weather) else 1.0
        legs.append(Leg(leg_distance, leg_weather))

    return legs
