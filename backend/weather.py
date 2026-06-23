"""Live marine weather -> per-leg fuel weather factors (Open-Meteo, free, no key).

For each leg we query the Open-Meteo Marine API at a representative point and map
the wave height to the multiplicative weather factor the fuel model already uses
(1.0 calm .. 1.6 storm).

ENGINEERING NOTES (the point of this module):
  - All legs are fetched CONCURRENTLY with asyncio.gather, not one-by-one.
  - Every request has its own timeout; on timeout/error a leg falls back to a
    calm 1.0 factor so the app never hangs or crashes on a flaky network.
  - A short-lived in-memory TTL cache (keyed by rounded lat/lon) avoids re-hitting
    the API for the same area within a few minutes.

The wave -> factor mapping is OUR simplified heuristic; real added resistance
depends on hull geometry and heading. Disclosed as an approximation in AUDIT.md.
"""

import asyncio
import time

import httpx

MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

KMH_TO_KN = 0.539957  # ocean_current_velocity comes in km/h; we work in knots

REQUEST_TIMEOUT_S = 4.0  # per-request timeout; a slow leg must not block the rest
CACHE_TTL_S = 600  # 10 minutes
_CACHE: dict[tuple[float, float], tuple[float, dict]] = {}  # key -> (expires_at, data)


def wind_ms_to_beaufort(wind_ms):
    """Map wind speed (m/s) to a Beaufort force number 0..12 (standard scale).

    The Beaufort scale upper-bound wind speeds (m/s) for forces 0..11; anything
    above the last bound is force 12 (hurricane). Returns 0 for missing wind.
    """
    if wind_ms is None:
        return 0
    bounds = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7]
    for force, upper in enumerate(bounds):
        if wind_ms < upper:
            return force
    return 12


def wave_to_weather_factor(wave_m):
    """Map significant wave height (m) to a fuel weather factor in [1.0, 1.6].

    Banded heuristic:
        < 1 m  -> 1.0   (calm)
        1-2 m  -> 1.1
        2-3 m  -> 1.25
        3-5 m  -> 1.45
        > 5 m  -> 1.6   (storm)

    NOTE: this is OUR simplified mapping. Real added wave resistance depends on
    hull form, heading relative to the swell, and vessel speed; this band model
    is a transparent stand-in (see AUDIT.md).
    """
    if wave_m is None:
        return 1.0
    if wave_m < 1:
        return 1.0
    if wave_m < 2:
        return 1.1
    if wave_m < 3:
        return 1.25
    if wave_m < 5:
        return 1.45
    return 1.6


def _cache_key(lat, lon):
    # Round to ~0.5 degree (~30 nm) so nearby points share a cache entry.
    return (round(lat * 2) / 2, round(lon * 2) / 2)


def _cache_get(lat, lon):
    key = _cache_key(lat, lon)
    hit = _CACHE.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    return None


def _cache_put(lat, lon, data):
    _CACHE[_cache_key(lat, lon)] = (time.time() + CACHE_TTL_S, data)


async def _fetch_one(client, lat, lon):
    """Fetch weather for a single point, with cache + graceful fallback.

    Returns a dict: {factor, wave_m, wind_ms, wind_dir, beaufort, current_kn,
    current_dir, source}. On any timeout or error, returns a calm fallback (B=0,
    wind_dir=None, current_kn=0) so a single bad leg never breaks the voyage.
    """
    cached = _cache_get(lat, lon)
    if cached is not None:
        return cached

    fallback = {
        "factor": 1.0,
        "wave_m": None,
        "wind_ms": None,
        "wind_dir": None,
        "beaufort": 0,
        "current_kn": 0.0,
        "current_dir": None,
        "source": "fallback",
    }
    try:
        # Primary signal: wave height (+ ocean surface current).
        marine = await client.get(
            MARINE_URL,
            params={
                "latitude": lat,
                "longitude": lon,
                "current": (
                    "wave_height,wind_wave_height,"
                    "ocean_current_velocity,ocean_current_direction"
                ),
                "timezone": "UTC",
            },
            timeout=REQUEST_TIMEOUT_S,
        )
        marine.raise_for_status()
        cur = marine.json().get("current", {})
        wave_m = cur.get("wave_height")
        current_kmh = cur.get("ocean_current_velocity")
        current_kn = current_kmh * KMH_TO_KN if current_kmh is not None else 0.0
        current_dir = cur.get("ocean_current_direction")

        # Secondary (best-effort): wind speed + direction. Failure here must not
        # fail the leg — it just means no Beaufort / wind-angle effect this leg.
        wind_ms = None
        wind_dir = None
        try:
            wind = await client.get(
                FORECAST_URL,
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "current": "wind_speed_10m,wind_direction_10m",
                    "wind_speed_unit": "ms",
                    "timezone": "UTC",
                },
                timeout=REQUEST_TIMEOUT_S,
            )
            wind.raise_for_status()
            wind_cur = wind.json().get("current", {})
            wind_ms = wind_cur.get("wind_speed_10m")
            wind_dir = wind_cur.get("wind_direction_10m")
        except (httpx.HTTPError, ValueError):
            pass

        data = {
            "factor": wave_to_weather_factor(wave_m),
            "wave_m": wave_m,
            "wind_ms": wind_ms,
            "wind_dir": wind_dir,
            "beaufort": wind_ms_to_beaufort(wind_ms),
            "current_kn": round(current_kn, 2),
            "current_dir": current_dir,
            "source": "open-meteo",
        }
        _cache_put(lat, lon, data)
        return data
    except (httpx.HTTPError, ValueError):
        return fallback


async def fetch_leg_weather(points):
    """Fetch weather for every leg point CONCURRENTLY.

    Args:
        points: list of (lat, lon) representative points, one per leg.

    Returns:
        list of dicts (same length/order as points): {factor, wave_m, wind_ms,
        wind_dir, beaufort, current_kn, current_dir, source}. Legs that time out
        or error come back as a calm "fallback" (B=0, wind_dir=None, current_kn=0).
    """
    async with httpx.AsyncClient() as client:
        tasks = [_fetch_one(client, lat, lon) for lat, lon in points]
        return await asyncio.gather(*tasks)
