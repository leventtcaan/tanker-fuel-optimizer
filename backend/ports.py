"""Known ports for route lookups: name -> (lat, lon).

Coordinates are (latitude, longitude) in decimal degrees. Note that searoute
expects [lon, lat] order, so callers must swap when passing these to it.
"""

PORTS = {
    "İstanbul (Ambarlı)": (41.0, 28.95),
    "İzmir (Aliağa)": (38.8, 26.97),
    "Singapore": (1.29, 103.8),
    "Rotterdam": (51.95, 4.14),
    "Gibraltar": (36.14, -5.35),
    "Fujairah": (25.17, 56.33),
    "Hamburg": (53.54, 9.97),
    "Cebelitarık→Süveyş test": (31.26, 32.3),
}
