"""Cached, public environmental layers used by the live map."""

from __future__ import annotations

import json
import hashlib
import csv
import gzip
import io
import logging
import threading
import time
from datetime import UTC, datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

logger = logging.getLogger("rivercast.live_data")
_lock = threading.Lock()
_cache: dict[str, tuple[float, dict]] = {}


def _get_json(url: str) -> dict | list:
    request = Request(url, headers={"User-Agent": "RiverCast-WebGIS/1.0", "Accept": "application/json"})
    with urlopen(request, timeout=18) as response:
        payload = response.read(8_000_000)
        return json.loads(payload) if payload else []


def _cached(key: str, ttl_seconds: int, loader) -> dict:
    now = time.monotonic()
    with _lock:
        cached = _cache.get(key)
        if cached and cached[0] > now:
            return cached[1]
    value = loader()
    with _lock:
        _cache[key] = (now + ttl_seconds, value)
    return value


def rainfall_grid() -> dict:
    """Return an interpolated, next-hour precipitation grid over India."""
    def load() -> dict:
        # A ~2.5 degree grid keeps requests small and provider load low.
        coordinates = [(round(6 + lat * 2.5, 2), round(67 + lon * 2.5, 2)) for lat in range(13) for lon in range(13)]
        features = []
        valid_at = None
        for offset in range(0, len(coordinates), 40):
            batch = coordinates[offset:offset + 40]
            query = urlencode({
                "latitude": ",".join(str(item[0]) for item in batch),
                "longitude": ",".join(str(item[1]) for item in batch),
                "hourly": "precipitation",
                "forecast_hours": 1,
                "timezone": "UTC",
            })
            response = _get_json(f"https://api.open-meteo.com/v1/forecast?{query}")
            locations = response if isinstance(response, list) else [response]
            for location in locations:
                hourly = location.get("hourly") or {}
                times = hourly.get("time") or []
                values = hourly.get("precipitation") or []
                if not times or not values or values[0] is None:
                    continue
                valid_at = valid_at or times[0]
                rainfall = max(0.0, float(values[0]))
                lat, lon = float(location["latitude"]), float(location["longitude"])
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {"precipitation_mm": rainfall, "weight": min(1.0, rainfall / 20.0)},
                })
        return {
            "type": "FeatureCollection", "features": features,
            "source": "Open-Meteo", "source_url": "https://open-meteo.com/",
            "layer": "next-hour precipitation model", "units": "mm",
            "valid_at": valid_at, "fetched_at": datetime.now(UTC).isoformat(),
        }

    return _cached("rainfall-grid", 1800, load)


def station_weather(stations: list[dict]) -> dict:
    """Return current model weather at registered station locations."""
    normalized = [
        {"station_id": str(item["station_id"]), "latitude": float(item["latitude"]), "longitude": float(item["longitude"])}
        for item in stations
    ]
    if not normalized:
        return {"stations": [], "source": "Open-Meteo", "source_url": "https://open-meteo.com/", "fetched_at": datetime.now(UTC).isoformat()}
    cache_key = "station-weather-" + hashlib.sha256(json.dumps(normalized, sort_keys=True).encode()).hexdigest()

    def load() -> dict:
        readings = []
        for offset in range(0, len(normalized), 40):
            batch = normalized[offset:offset + 40]
            query = urlencode({
                "latitude": ",".join(str(item["latitude"]) for item in batch),
                "longitude": ",".join(str(item["longitude"]) for item in batch),
                "current": "temperature_2m,precipitation,wind_speed_10m,wind_direction_10m",
                "timezone": "UTC",
            })
            response = _get_json(f"https://api.open-meteo.com/v1/forecast?{query}")
            locations = response if isinstance(response, list) else [response]
            for station, location in zip(batch, locations):
                current = location.get("current") or {}
                readings.append({
                    **station,
                    "valid_at": current.get("time"),
                    "temperature_c": current.get("temperature_2m"),
                    "precipitation_mm": current.get("precipitation"),
                    "wind_speed_kmh": current.get("wind_speed_10m"),
                    "wind_direction_degrees": current.get("wind_direction_10m"),
                })
        return {
            "stations": readings, "source": "Open-Meteo",
            "source_url": "https://open-meteo.com/",
            "fetched_at": datetime.now(UTC).isoformat(),
        }

    return _cached(cache_key, 900, load)


def metar_stations(south: float, west: float, north: float, east: float) -> dict:
    """Return global current METAR observations inside the requested map bounds."""
    def load_global() -> dict:
        url = "https://aviationweather.gov/data/cache/metars.cache.csv.gz"
        request = Request(url, headers={"User-Agent": "RiverCast-WebGIS/1.0", "Accept": "application/gzip"})
        with urlopen(request, timeout=25) as response:
            payload = gzip.decompress(response.read(20_000_000))
        latest_by_station: dict[str, dict] = {}

        def number(value: str | None) -> float | None:
            try:
                return float(value) if value not in (None, "") else None
            except ValueError:
                return None

        for report in csv.DictReader(io.StringIO(payload.decode("utf-8-sig"))):
            icao = (report.get("station_id") or "").strip()
            latitude = number(report.get("latitude"))
            longitude = number(report.get("longitude"))
            if not icao or latitude is None or longitude is None:
                continue
            report_time = report.get("observation_time") or None
            try:
                wind_speed = float(report["wind_speed_kt"]) * 1.852 if report.get("wind_speed_kt") else None
            except ValueError:
                wind_speed = None
            try:
                wind_gust = float(report["wind_gust_kt"]) * 1.852 if report.get("wind_gust_kt") else None
            except ValueError:
                wind_gust = None
            visibility_mi = report.get("visibility_statute_mi") or ""
            visibility_km = number(visibility_mi.rstrip("+"))
            if visibility_km is not None:
                visibility_km *= 1.60934
            latest_by_station[icao] = {
                "station_id": icao,
                "name": icao,
                "latitude": latitude,
                "longitude": longitude,
                "valid_at": report_time,
                "temperature_c": number(report.get("temp_c")),
                "dew_point_c": number(report.get("dewpoint_c")),
                "wind_speed_kmh": wind_speed,
                "wind_gust_kmh": wind_gust,
                "wind_direction_degrees": number(report.get("wind_dir_degrees")),
                "visibility_km": visibility_km,
                "weather": report.get("wx_string") or None,
                "flight_category": report.get("flight_category") or None,
                "raw_report": report.get("raw_text") or None,
            }

        return {
            "stations": list(latest_by_station.values()),
            "source": "Aviation Weather Center METAR",
            "source_url": "https://aviationweather.gov/data/api/",
            "fetched_at": datetime.now(UTC).isoformat(),
        }

    global_data = _cached("metar-global-current", 60, load_global)
    reports = [
        station for station in global_data["stations"]
        if south <= station["latitude"] <= north
        and (west <= station["longitude"] <= east if west <= east else station["longitude"] >= west or station["longitude"] <= east)
    ]
    return {**global_data, "stations": sorted(reports, key=lambda item: item["valid_at"] or "", reverse=True)}


def radar_frames() -> dict:
    """Get recent radar frames and tile URL from RainViewer."""
    def load() -> dict:
        response = _get_json("https://api.rainviewer.com/public/weather-maps.json")
        radar = response.get("radar") or {}
        frames = radar.get("past") or []
        if not frames:
            raise ValueError("RainViewer has no recent radar frames")
        host = response["host"].rstrip("/")
        latest = frames[-1]
        return {
            "source": "RainViewer", "source_url": "https://www.rainviewer.com/",
            "fetched_at": datetime.now(UTC).isoformat(),
            "latest_at": datetime.fromtimestamp(int(latest["time"]), UTC).isoformat(),
            "tile_url": f"{host}{latest['path']}/256/{{z}}/{{x}}/{{y}}/2/1_0.png",
            "frames": [{"time": frame["time"], "path": frame["path"]} for frame in frames],
        }

    return _cached("radar-frames", 300, load)


def cyclone_events() -> dict:
    """Return the latest two weeks of GDACS tropical-cyclone GeoJSON alerts."""
    def load() -> dict:
        today = datetime.now(UTC).date()
        since = today - timedelta(days=14)
        query = urlencode({
            "eventlist": "TC", "fromdate": since.isoformat(), "todate": today.isoformat(),
            "alertlevel": "red;orange;green", "pagesize": 100,
        })
        response = _get_json(f"https://www.gdacs.org/gdacsapi/api/Events/geteventlist/SEARCH?{query}")
        if isinstance(response, dict) and response.get("type") == "FeatureCollection":
            geojson = response
        elif isinstance(response, dict) and isinstance(response.get("features"), list):
            geojson = {"type": "FeatureCollection", "features": response["features"]}
        elif isinstance(response, dict) and isinstance(response.get("data"), dict):
            geojson = response["data"]
        else:
            raise ValueError("GDACS returned an unsupported cyclone data format")
        # The event search returns centroids. Fetch each active storm's GIS
        # detail as well so the frontend can draw its published track/cone.
        active = [
            feature for feature in geojson.get("features", [])
            if str(feature.get("properties", {}).get("iscurrent", "")).lower() == "true"
            and (feature.get("properties", {}).get("url") or {}).get("geometry")
        ][:12]

        def load_geometry(event: dict) -> list[dict]:
            try:
                detail = _get_json(event["properties"]["url"]["geometry"])
                return detail.get("features", []) if isinstance(detail, dict) else []
            except Exception as exc:
                logger.info("Cyclone geometry unavailable for event %s: %s", event.get("properties", {}).get("eventid"), exc)
                return []

        with ThreadPoolExecutor(max_workers=4) as pool:
            detail_features = [feature for group in pool.map(load_geometry, active) for feature in group]
        if detail_features:
            geojson["features"] = geojson.get("features", []) + detail_features
        return {
            **geojson,
            "source": "GDACS", "source_url": "https://www.gdacs.org/",
            "fetched_at": datetime.now(UTC).isoformat(),
        }

    return _cached("cyclones", 900, load)


def provider_error(exc: Exception) -> str:
    if isinstance(exc, (TimeoutError, URLError)):
        return "The public data provider is temporarily unavailable. Try again shortly."
    logger.warning("Live map provider error: %s", exc)
    return "The public data provider returned an invalid or unavailable response."
