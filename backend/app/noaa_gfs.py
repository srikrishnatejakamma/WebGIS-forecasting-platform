"""Download a small, regional precipitation subset from NOAA's public GFS feed."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from time import sleep
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


BASE_URL = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"


def _candidate_cycles(now: datetime) -> list[datetime]:
    # NOMADS cycles may take a few hours to appear. Start four hours behind
    # wall time and try recent cycles if the newest one is not ready yet.
    cursor = (now - timedelta(hours=4)).replace(minute=0, second=0, microsecond=0)
    cursor = cursor.replace(hour=(cursor.hour // 6) * 6)
    return [cursor - timedelta(hours=6 * index) for index in range(4)]


def download_latest_precipitation(destination: Path) -> dict:
    """Fetch the latest available GFS f003 APCP subset over the Indian region."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None

    for index, cycle in enumerate(_candidate_cycles(datetime.now(UTC))):
        if index:
            # NOAA asks automated clients to pause at least 10 seconds between
            # repeated filter requests.
            sleep(10)
        params = {
            "file": f"gfs.t{cycle:%H}z.pgrb2.0p25.f003",
            "lev_surface": "on",
            "var_APCP": "on",
            "subregion": "on",
            "leftlon": "67",
            "rightlon": "98",
            "toplat": "30",
            "bottomlat": "5",
            "dir": f"/gfs.{cycle:%Y%m%d}/{cycle:%H}/atmos",
        }
        request = Request(
            f"{BASE_URL}?{urlencode(params)}",
            headers={"User-Agent": "RiverCast/1.0 (regional research data client)"},
        )
        try:
            with urlopen(request, timeout=180) as response:
                payload = response.read(200_000_001)
            if len(payload) > 200_000_000:
                raise ValueError("NOAA response exceeded the 200 MB import limit")
            if len(payload) < 100 or not payload.startswith(b"GRIB"):
                raise ValueError("NOAA did not return a GRIB2 file; the selected cycle may not be available yet")
            destination.write_bytes(payload)
            return {
                "cycle": cycle.isoformat(),
                "forecast_hour": 3,
                "valid_at": (cycle + timedelta(hours=3)).isoformat(),
                "size_bytes": len(payload),
                "source_url": f"{BASE_URL}?{urlencode(params)}",
            }
        except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
            last_error = exc

    raise RuntimeError(f"Could not fetch a recent NOAA GFS file: {last_error}") from last_error
