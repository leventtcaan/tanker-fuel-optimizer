"""Live vessel data for the Karadeniz Holding tanker fleet (VesselFinder AIS).

Given a fixed list of IMO numbers, this module fetches real-time AIS data
(position, speed, course, draught, destination, ...) plus master data (DWT,
name, type) from the VesselFinder "vessels" API and feeds it to the optimizer
demo so the user can compare a ship's REAL current speed against PRUVA's
fuel-optimal suggestion.

SECURITY: the API key is read at call time from the VESSELFINDER_API_KEY
environment variable (loaded from backend/.env, which is gitignored). It is
never hardcoded, never logged, and never written to .env.example.

TRIAL LIMITS (important): the trial key allows ~1 query/hour for 5 vessels over
5 days. To respect that:
  - One batched request fetches ALL fleet vessels at once (the API accepts a
    comma-separated IMO list), so selecting any vessel costs at most one query.
  - Results are cached per IMO for >= 1 hour (CACHE_TTL_S).
  - A process-level rate guard refuses to call the API more often than once per
    hour, even on a cache miss, so the app cannot hammer the endpoint.

GRACEFUL FALLBACK: if the key is missing, the API errors, or we are inside the
hourly rate window with no cached data, fetch_vessel returns
{available: False, reason: ...} instead of raising — the demo keeps working with
manual DWT/draft entry.
"""

import asyncio
import os
import time

import httpx
from dotenv import load_dotenv

# Load backend/.env so os.getenv can see VESSELFINDER_API_KEY. Safe to call at
# import: it does not override variables already present in the environment.
load_dotenv()

VESSELFINDER_URL = "https://api.vesselfinder.com/vessels"

# Fixed fleet: Karadeniz Holding tankers, by IMO. The display names are
# placeholders for the dropdown; a successful query overrides them with the
# real MASTERDATA/AIS name from VesselFinder.
VESSELS = [
    {"imo": 9359600, "name": "KH Tanker 1 (IMO 9359600)"},
    {"imo": 9447287, "name": "KH Tanker 2 (IMO 9447287)"},
    {"imo": 9311646, "name": "KH Tanker 3 (IMO 9311646)"},
    {"imo": 9378022, "name": "KH Tanker 4 (IMO 9378022)"},
    {"imo": 9443841, "name": "KH Tanker 5 (IMO 9443841)"},
]

_IMOS = [v["imo"] for v in VESSELS]
_FLEET = {v["imo"] for v in VESSELS}
_NAME_BY_IMO = {v["imo"]: v["name"] for v in VESSELS}

REQUEST_TIMEOUT_S = 6.0  # per-request timeout; the demo must not hang on a slow API

# Trial limit is ~1 query/hour. Cache each vessel for an hour and never call the
# API more than once per hour (the guard is per-process; the long-lived server
# is the real usage path).
CACHE_TTL_S = 3600
_MIN_CALL_INTERVAL_S = 3600

_CACHE: dict[int, tuple[float, dict]] = {}  # imo -> (expires_at, data)
_last_call_at = 0.0  # epoch seconds of the last actual API call (rate guard)
_lock = asyncio.Lock()  # serialize batched refreshes across concurrent requests


def _api_key():
    """Read the VesselFinder key from the environment (never logged)."""
    return os.getenv("VESSELFINDER_API_KEY")


def _unavailable(imo, reason):
    """Uniform 'no live data' payload so the frontend can degrade gracefully."""
    return {
        "imo": imo,
        "name": _NAME_BY_IMO.get(imo, str(imo)),
        "available": False,
        "reason": reason,
    }


def _cache_get(imo):
    hit = _CACHE.get(imo)
    if hit and hit[0] > time.time():
        return hit[1]
    return None


def _parse(imo, ais, master):
    """Shape one VesselFinder record into our flat vessel dict.

    SPEED is in knots and DRAUGHT in metres per the VesselFinder docs. Master
    data (DWT, name, type) is only present when extradata=master is honoured;
    we fall back to AIS fields / the placeholder name when it is absent.
    """
    name = master.get("NAME") or ais.get("NAME") or _NAME_BY_IMO.get(imo)
    return {
        "imo": imo,
        "name": name,
        "available": True,
        "speed_kn": ais.get("SPEED"),
        "course": ais.get("COURSE"),
        "heading": ais.get("HEADING"),
        "nav_status": ais.get("NAVSTAT"),
        "lat": ais.get("LATITUDE"),
        "lon": ais.get("LONGITUDE"),
        "draught_m": ais.get("DRAUGHT"),
        "dwt": master.get("DWT"),
        "vessel_type": master.get("TYPE") or ais.get("TYPE"),
        "destination": ais.get("DESTINATION"),
        "eta": ais.get("ETA"),
        "timestamp": ais.get("TIMESTAMP"),
        "source": "vesselfinder",
    }


async def _refresh_all():
    """Make ONE batched VesselFinder call for the whole fleet and cache each.

    Rate-guarded: returns immediately (without calling) if we are still inside
    the hourly window. The rate timestamp is set BEFORE the request so a
    transient failure or over-limit response still counts as the hour's single
    attempt — we never retry-hammer a flaky or rate-limited API.
    """
    global _last_call_at
    key = _api_key()
    if not key:
        return
    async with _lock:
        now = time.time()
        # Another coroutine may have refreshed while we waited for the lock.
        if _last_call_at > 0 and now - _last_call_at < _MIN_CALL_INTERVAL_S:
            return
        _last_call_at = now
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    VESSELFINDER_URL,
                    params={
                        "userkey": key,
                        "imo": ",".join(str(i) for i in _IMOS),
                        "format": "json",
                        "extradata": "master",
                    },
                    timeout=REQUEST_TIMEOUT_S,
                )
                resp.raise_for_status()
                records = resp.json()
        except (httpx.HTTPError, ValueError):
            return  # leave the cache as-is; callers get a clean available:false
        # A successful trial response is a JSON array of {AIS, MASTERDATA}. On an
        # auth/over-limit error VesselFinder may return a JSON string or object
        # instead; treat anything that is not a list of records as "no data" so
        # we degrade gracefully rather than crash.
        if not isinstance(records, list):
            return
        expires = time.time() + CACHE_TTL_S
        for rec in records:
            if not isinstance(rec, dict):
                continue
            ais = rec.get("AIS") or {}
            master = rec.get("MASTERDATA") or rec.get("MASTER") or {}
            if not isinstance(ais, dict) or not isinstance(master, dict):
                continue
            raw_imo = ais.get("IMO") or master.get("IMO")
            try:
                imo = int(raw_imo)
            except (TypeError, ValueError):
                continue
            _CACHE[imo] = (expires, _parse(imo, ais, master))


async def fetch_vessel(imo):
    """Live AIS data for one fleet vessel, cached and rate-limited.

    Returns the parsed vessel dict on success, or a {available: False, reason}
    fallback if the key is missing, the API is unreachable/over-limit, or no
    cached data exists yet inside the hourly rate window. Never raises.
    """
    if not _api_key():
        return _unavailable(imo, "no_api_key")
    cached = _cache_get(imo)
    if cached is not None:
        return cached
    await _refresh_all()
    cached = _cache_get(imo)
    if cached is not None:
        return cached
    # No key issue, but no data: either the hourly guard blocked the call or the
    # API errored / didn't return this IMO.
    return _unavailable(imo, "unavailable")
