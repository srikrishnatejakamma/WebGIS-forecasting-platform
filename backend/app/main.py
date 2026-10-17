"""RiverCast WebGIS API and application."""

from __future__ import annotations

import csv
import io
import json
import logging
import math
import os
import re
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, Response, UploadFile
from geoalchemy2.shape import from_shape
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload
from starlette.concurrency import run_in_threadpool
from apscheduler.schedulers.background import BackgroundScheduler

from .database import SessionLocal, get_session, initialize_database
from .forecasting import create_forecast_run, create_forecast_run_tracked
from .live_data import cpcb_air_quality_stations, cyclone_events, metar_stations, provider_error, radar_frames, rainfall_grid, river_gauge_stations, station_weather
from .models import ForecastRunRecord, GriddedAssetRecord, ObservationRecord, StationRecord
from .processing import convert_to_cog
from .storage import ensure_bucket, upload as upload_object


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data"))
RASTER_DIR = DATA_DIR / "rasters"
ALLOWED_RASTER_TYPES = {".tif", ".tiff", ".nc", ".grib", ".grb", ".grb2"}
logger = logging.getLogger("rivercast")
scheduler = BackgroundScheduler(timezone="UTC")


class StationOut(BaseModel):
    id: str
    name: str
    river: str
    latitude: float
    longitude: float
    current_discharge_m3s: float
    alert_level_m3s: float
    status: Literal["normal", "watch", "warning"]
    observed_at: datetime | None
    is_demo_data: bool


class StationCreate(BaseModel):
    id: str = Field(min_length=3, max_length=100, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    name: str = Field(min_length=1, max_length=160)
    river: str = Field(min_length=1, max_length=160)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    alert_level_m3s: float = Field(gt=0)


class ForecastPointOut(BaseModel):
    valid_at: datetime
    discharge_m3s: float
    rainfall_mm: float


class ObservationsOut(BaseModel):
    station_id: str
    station_name: str
    units: dict[str, str]
    points: list[ForecastPointOut]


class ForecastOut(BaseModel):
    run_id: int
    station_id: str
    station_name: str
    model_name: str
    model_version: str
    units: dict[str, str]
    generated_at: datetime
    is_demo_data: bool
    points: list[ForecastPointOut]


class ImportResponse(BaseModel):
    imported_rows: int
    changed_stations: list[str]
    latest_observation_at: datetime


class RunSummary(BaseModel):
    id: int
    station_id: str
    station_name: str
    generated_at: datetime
    status: str
    model_name: str
    model_version: str
    is_demo_data: bool
    error_message: str | None = None


def _seed_demo_data() -> None:
    with SessionLocal() as session:
        if session.scalar(select(func.count()).select_from(StationRecord)):
            return
        now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
        seed = [
            ("brahmaputra-guwahati", "Guwahati", "Brahmaputra", 26.1445, 91.7362, 14800, 22000),
            ("ganga-patna", "Patna", "Ganga", 25.5941, 85.1376, 19700, 24000),
            ("godavari-rajahmundry", "Rajahmundry", "Godavari", 17.0005, 81.8040, 8300, 18000),
            ("mahanadi-sambalpur", "Sambalpur", "Mahanadi", 21.4669, 83.9812, 11200, 15000),
        ]
        for station_id, name, river, latitude, longitude, discharge, threshold in seed:
            station = StationRecord(
                id=station_id,
                name=name,
                river=river,
                latitude=latitude,
                longitude=longitude,
                location=from_shape(_point(longitude, latitude), srid=4326),
                alert_level_m3s=threshold,
                is_demo_data=True,
            )
            station.observations.append(
                ObservationRecord(
                    observed_at=now - timedelta(hours=1),
                    discharge_m3s=discharge,
                    rainfall_mm=2.0,
                    source="synthetic-demo",
                )
            )
            session.add(station)
        session.commit()


def _scheduled_forecasts() -> None:
    try:
        with SessionLocal() as session:
            stations = session.scalars(select(StationRecord)).all()
            failed = 0
            for station in stations:
                run = create_forecast_run_tracked(session, station, hours=48)
                failed += run.status == "failed"
            session.commit()
            logger.info("Scheduled forecasts finished for %s stations (%s failed)", len(stations), failed)
    except Exception:
        logger.exception("Scheduled forecast run failed")


def _point(longitude: float, latitude: float):
    from shapely.geometry import Point

    return Point(longitude, latitude)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await run_in_threadpool(initialize_database)
    await run_in_threadpool(_seed_demo_data)
    if os.getenv("MINIO_ENDPOINT"):
        await run_in_threadpool(ensure_bucket)
    scheduler.add_job(_scheduled_forecasts, "interval", hours=6, id="rivercast-forecasts", replace_existing=True)
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(
    title="RiverCast WebGIS",
    description="Hydrological monitoring, observation ingestion, and forecast runs.",
    version="0.2.0",
    lifespan=lifespan,
)
def _write_access(x_api_token: str | None = Header(default=None)) -> None:
    expected = os.getenv("API_WRITE_TOKEN", "").strip()
    if expected and x_api_token != expected:
        raise HTTPException(status_code=401, detail="A valid X-API-Token is required")


@app.get("/api/health")
def health(session: Session = Depends(get_session)) -> dict[str, str | bool]:
    try:
        session.execute(select(func.count()).select_from(StationRecord)).scalar_one()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Database unavailable") from exc
    return {"status": "ok", "database": "postgis", "data_mode": "persistent", "write_auth_enabled": bool(os.getenv("API_WRITE_TOKEN", "").strip())}


@app.get("/health", include_in_schema=False)
def root_health(session: Session = Depends(get_session)) -> dict[str, str | bool]:
    return health(session)


@app.get("/api/live/rainfall")
def live_rainfall() -> dict:
    try:
        return rainfall_grid()
    except Exception as exc:
        logger.warning("Could not load live rainfall grid: %s", exc)
        raise HTTPException(status_code=503, detail=provider_error(exc)) from exc


@app.get("/api/live/stations")
def live_station_weather(session: Session = Depends(get_session)) -> dict:
    stations = session.scalars(select(StationRecord).order_by(StationRecord.name)).all()
    inputs = [{"station_id": station.id, "latitude": station.latitude, "longitude": station.longitude} for station in stations]
    try:
        return station_weather(inputs)
    except Exception as exc:
        logger.warning("Could not load live station weather: %s", exc)
        raise HTTPException(status_code=503, detail=provider_error(exc)) from exc


@app.get("/api/live/weather-stations")
def live_weather_stations(
    south: float = Query(-85.0, ge=-90, le=90),
    west: float = Query(-180.0, ge=-180, le=180),
    north: float = Query(85.0, ge=-90, le=90),
    east: float = Query(180.0, ge=-180, le=180),
) -> dict:
    if north <= south or (east <= west and not (west > 0 and east < 0)):
        raise HTTPException(status_code=422, detail="Map bounds must have a positive latitude and longitude span")
    try:
        return metar_stations(south, west, north, east)
    except Exception as exc:
        logger.warning("Could not load live METAR weather stations: %s", exc)
        raise HTTPException(status_code=503, detail=provider_error(exc)) from exc


@app.get("/api/live/river-stations")
def live_river_stations(
    south: float = Query(-85.0, ge=-90, le=90),
    west: float = Query(-180.0, ge=-180, le=180),
    north: float = Query(85.0, ge=-90, le=90),
    east: float = Query(180.0, ge=-180, le=180),
) -> dict:
    if north <= south or (east <= west and not (west > 0 and east < 0)):
        raise HTTPException(status_code=422, detail="Map bounds must have a positive latitude and longitude span")
    return river_gauge_stations(south, west, north, east)


@app.get("/api/live/air-quality-stations")
def live_air_quality_stations(
    south: float = Query(-85.0, ge=-90, le=90),
    west: float = Query(-180.0, ge=-180, le=180),
    north: float = Query(85.0, ge=-90, le=90),
    east: float = Query(180.0, ge=-180, le=180),
) -> dict:
    if north <= south or (east <= west and not (west > 0 and east < 0)):
        raise HTTPException(status_code=422, detail="Map bounds must have a positive latitude and longitude span")
    try:
        return cpcb_air_quality_stations(south, west, north, east)
    except Exception as exc:
        logger.warning("Could not load CPCB air-quality stations: %s", exc)
        raise HTTPException(status_code=503, detail=provider_error(exc)) from exc


@app.get("/api/live/radar")
def live_radar() -> dict:
    try:
        return radar_frames()
    except Exception as exc:
        logger.warning("Could not load live precipitation radar: %s", exc)
        raise HTTPException(status_code=503, detail=provider_error(exc)) from exc


@app.get("/api/live/cyclones")
def live_cyclones() -> dict:
    try:
        return cyclone_events()
    except Exception as exc:
        logger.warning("Could not load live cyclone events: %s", exc)
        raise HTTPException(status_code=503, detail=provider_error(exc)) from exc


def _latest_observation(session: Session, station_id: str) -> ObservationRecord | None:
    return session.scalar(
        select(ObservationRecord)
        .where(ObservationRecord.station_id == station_id)
        .order_by(ObservationRecord.observed_at.desc())
        .limit(1)
    )


def _station_out(session: Session, station: StationRecord) -> StationOut:
    latest = _latest_observation(session, station.id)
    discharge = latest.discharge_m3s if latest else 0.0
    ratio = discharge / station.alert_level_m3s if station.alert_level_m3s else 0
    status: Literal["normal", "watch", "warning"] = (
        "warning" if ratio >= 0.9 else "watch" if ratio >= 0.7 else "normal"
    )
    return StationOut(
        id=station.id,
        name=station.name,
        river=station.river,
        latitude=station.latitude,
        longitude=station.longitude,
        current_discharge_m3s=discharge,
        alert_level_m3s=station.alert_level_m3s,
        status=status,
        observed_at=latest.observed_at if latest else None,
        is_demo_data=station.is_demo_data,
    )


@app.get("/api/stations", response_model=list[StationOut])
def list_stations(session: Session = Depends(get_session)) -> list[StationOut]:
    stations = session.scalars(select(StationRecord).order_by(StationRecord.name)).all()
    return [_station_out(session, station) for station in stations]


@app.post("/api/stations", response_model=StationOut, dependencies=[Depends(_write_access)])
def create_station(payload: StationCreate, session: Session = Depends(get_session)) -> StationOut:
    if session.get(StationRecord, payload.id):
        raise HTTPException(status_code=409, detail="A station with this ID already exists")
    station = StationRecord(
        id=payload.id,
        name=payload.name.strip(),
        river=payload.river.strip(),
        latitude=payload.latitude,
        longitude=payload.longitude,
        location=from_shape(_point(payload.longitude, payload.latitude), srid=4326),
        alert_level_m3s=payload.alert_level_m3s,
        is_demo_data=False,
    )
    session.add(station)
    session.commit()
    return _station_out(session, station)


@app.get("/api/geo/stations")
def stations_geojson(session: Session = Depends(get_session)) -> dict:
    stations = session.scalars(select(StationRecord).order_by(StationRecord.name)).all()
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": station.id,
                "geometry": {"type": "Point", "coordinates": [station.longitude, station.latitude]},
                "properties": _station_out(session, station).model_dump(mode="json"),
            }
            for station in stations
        ],
    }


def _parse_observations(content: str, file_type: str) -> list[dict]:
    if file_type == "json":
        try:
            rows = json.loads(content)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail=f"Invalid JSON: {exc.msg}") from exc
        if isinstance(rows, dict):
            rows = rows.get("observations")
        if not isinstance(rows, list):
            raise HTTPException(status_code=422, detail="JSON must be an array or an object with an observations array")
        return rows
    reader = csv.DictReader(io.StringIO(content))
    required = {"station_id", "observed_at", "discharge_m3s"}
    if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
        raise HTTPException(status_code=422, detail="CSV headers must include station_id, observed_at, discharge_m3s; rainfall_mm is optional")
    return list(reader)


@app.post("/api/observations/import", response_model=ImportResponse, dependencies=[Depends(_write_access)])
async def import_observations(request: Request, session: Session = Depends(get_session)) -> ImportResponse:
    raw = await request.body()
    if len(raw) > 2_000_000:
        raise HTTPException(status_code=413, detail="Import must be smaller than 2 MB")
    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="Import must use UTF-8 encoding") from exc
    content_type = request.headers.get("content-type", "text/csv").split(";", 1)[0].lower()
    file_type = "json" if content_type == "application/json" else "csv"
    rows = _parse_observations(content, file_type)
    if not rows or len(rows) > 5000:
        raise HTTPException(status_code=422, detail="Import must contain between 1 and 5,000 rows")
    stations = {station.id: station for station in session.scalars(select(StationRecord)).all()}
    parsed: list[tuple[str, datetime, float, float]] = []
    errors: list[str] = []
    for line_number, row in enumerate(rows, start=2):
        if not isinstance(row, dict):
            errors.append(f"Row {line_number}: expected an object")
            continue
        station_id = str(row.get("station_id", "")).strip()
        if station_id not in stations:
            errors.append(f"Row {line_number}: unknown station_id '{station_id}'")
            continue
        try:
            timestamp = datetime.fromisoformat(str(row.get("observed_at", "")).strip().replace("Z", "+00:00"))
            if timestamp.tzinfo is None:
                raise ValueError("observed_at must include a timezone")
            discharge = float(row.get("discharge_m3s", ""))
            rainfall = float(row.get("rainfall_mm") or 0)
            if not math.isfinite(discharge) or not math.isfinite(rainfall) or min(discharge, rainfall) < 0:
                raise ValueError("measurements must be finite, non-negative numbers")
            parsed.append((station_id, timestamp.astimezone(UTC), discharge, rainfall))
        except (ValueError, TypeError) as exc:
            errors.append(f"Row {line_number}: invalid timestamp or measurement ({exc})")
    if errors:
        raise HTTPException(status_code=422, detail=errors[:20])

    parsed_by_key = {(station_id, observed_at): (station_id, observed_at, discharge, rainfall) for station_id, observed_at, discharge, rainfall in parsed}
    changed: set[str] = set()
    for station_id, observed_at, discharge, rainfall in parsed_by_key.values():
        existing = session.scalar(
            select(ObservationRecord).where(
                ObservationRecord.station_id == station_id,
                ObservationRecord.observed_at == observed_at,
            )
        )
        if existing:
            existing.discharge_m3s = discharge
            existing.rainfall_mm = rainfall
            existing.source = "file-import"
        else:
            session.add(ObservationRecord(
                station_id=station_id,
                observed_at=observed_at,
                discharge_m3s=discharge,
                rainfall_mm=rainfall,
                source="file-import",
            ))
        changed.add(station_id)
        stations[station_id].is_demo_data = False
    session.commit()
    for station_id in changed:
        create_forecast_run_tracked(session, stations[station_id], hours=48)
    session.commit()
    return ImportResponse(
        imported_rows=len(parsed),
        changed_stations=sorted(changed),
        latest_observation_at=max(item[1] for item in parsed),
    )


def _forecast_out(run: ForecastRunRecord) -> ForecastOut:
    return ForecastOut(
        run_id=run.id,
        station_id=run.station_id,
        station_name=run.station.name,
        model_name=run.model_name,
        model_version=run.model_version,
        units={"discharge": "m3/s", "rainfall": "mm/h"},
        generated_at=run.generated_at,
        is_demo_data=run.is_demo_data,
        points=[ForecastPointOut(valid_at=point.valid_at, discharge_m3s=point.discharge_m3s, rainfall_mm=point.rainfall_mm) for point in run.points],
    )


@app.get("/api/stations/{station_id}/forecast", response_model=ForecastOut)
def station_forecast(
    station_id: str,
    hours: int = Query(default=48, ge=6, le=120),
    session: Session = Depends(get_session),
) -> ForecastOut:
    station = session.get(StationRecord, station_id)
    if station is None:
        raise HTTPException(status_code=404, detail="Station not found")
    run = session.execute(
        select(ForecastRunRecord)
        .options(joinedload(ForecastRunRecord.station), joinedload(ForecastRunRecord.points))
        .where(ForecastRunRecord.station_id == station_id, ForecastRunRecord.status == "complete")
        .order_by(ForecastRunRecord.generated_at.desc())
        .limit(1)
    ).unique().scalar_one_or_none()
    now = datetime.now(UTC)
    if run is None or len(run.points) != hours + 1 or (now - run.generated_at).total_seconds() > 6 * 3600:
        run = create_forecast_run_tracked(session, station, hours)
        session.commit()
        if run.status == "failed":
            raise HTTPException(status_code=503, detail=f"Forecast run failed: {run.error_message}")
    return _forecast_out(run)


@app.get("/api/stations/{station_id}/observations", response_model=ObservationsOut)
def station_observations(
    station_id: str,
    hours: int = Query(default=168, ge=1, le=8760),
    session: Session = Depends(get_session),
) -> ObservationsOut:
    station = session.get(StationRecord, station_id)
    if station is None:
        raise HTTPException(status_code=404, detail="Station not found")
    since = datetime.now(UTC) - timedelta(hours=hours)
    records = session.scalars(
        select(ObservationRecord)
        .where(ObservationRecord.station_id == station_id, ObservationRecord.observed_at >= since)
        .order_by(ObservationRecord.observed_at)
        .limit(5000)
    ).all()
    return ObservationsOut(
        station_id=station.id,
        station_name=station.name,
        units={"discharge": "m3/s", "rainfall": "mm/h"},
        points=[ForecastPointOut(valid_at=row.observed_at, discharge_m3s=row.discharge_m3s, rainfall_mm=row.rainfall_mm) for row in records],
    )


@app.post("/api/forecast-runs", response_model=list[RunSummary], dependencies=[Depends(_write_access)])
def run_forecasts(
    hours: int = Query(default=48, ge=6, le=120),
    station_id: str | None = None,
    session: Session = Depends(get_session),
) -> list[RunSummary]:
    query = select(StationRecord).order_by(StationRecord.name)
    if station_id:
        query = query.where(StationRecord.id == station_id)
    stations = session.scalars(query).all()
    if station_id and not stations:
        raise HTTPException(status_code=404, detail="Station not found")
    runs = [create_forecast_run_tracked(session, station, hours) for station in stations]
    session.commit()
    return [RunSummary(id=run.id, station_id=run.station_id, station_name=run.station.name, generated_at=run.generated_at, status=run.status, model_name=run.model_name, model_version=run.model_version, is_demo_data=run.is_demo_data, error_message=run.error_message) for run in runs]


@app.get("/api/forecast-runs", response_model=list[RunSummary])
def list_forecast_runs(limit: int = Query(default=50, ge=1, le=200), session: Session = Depends(get_session)) -> list[RunSummary]:
    runs = session.scalars(
        select(ForecastRunRecord)
        .options(joinedload(ForecastRunRecord.station))
        .order_by(ForecastRunRecord.generated_at.desc())
        .limit(limit)
    ).unique().all()
    return [RunSummary(id=run.id, station_id=run.station_id, station_name=run.station.name, generated_at=run.generated_at, status=run.status, model_name=run.model_name, model_version=run.model_version, is_demo_data=run.is_demo_data, error_message=run.error_message) for run in runs]


def _inspect_raster(path: Path) -> dict:
    suffix = path.suffix.lower()
    info: dict = {"format": suffix.lstrip("."), "metadata_status": "stored; optional reader unavailable"}
    try:
        if suffix in {".tif", ".tiff"}:
            import numpy as np
            import rasterio

            with rasterio.open(path) as dataset:
                info.update({"driver": dataset.driver, "crs": str(dataset.crs), "bounds": list(dataset.bounds), "width": dataset.width, "height": dataset.height, "bands": dataset.count, "metadata_status": "read"})
                sample = dataset.read(1, out_shape=(min(dataset.height, 256), min(dataset.width, 256)), masked=True)
                valid = sample.compressed()
                if valid.size:
                    info["display_min"], info["display_max"] = (float(value) for value in np.nanpercentile(valid, (2, 98)))
        elif suffix in {".nc", ".grib", ".grb", ".grb2"}:
            import xarray as xr

            engine = "cfgrib" if suffix in {".grib", ".grb", ".grb2"} else None
            with xr.open_dataset(path, engine=engine) as dataset:
                info.update({"variables": list(dataset.data_vars), "dimensions": {key: value for key, value in dataset.sizes.items()}, "metadata_status": "read"})
    except ImportError:
        pass
    except Exception as exc:
        info.update({"metadata_status": "reader error", "metadata_error": str(exc)[:300]})
    return info


@app.post("/api/data/gridded", dependencies=[Depends(_write_access)])
async def upload_gridded_data(file: UploadFile = File(...), session: Session = Depends(get_session)) -> dict:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_RASTER_TYPES:
        raise HTTPException(status_code=415, detail=f"Supported formats: {', '.join(sorted(ALLOWED_RASTER_TYPES))}")
    raw = await file.read(200_000_001)
    if len(raw) > 200_000_000:
        raise HTTPException(status_code=413, detail="Gridded dataset must be smaller than 200 MB")
    RASTER_DIR.mkdir(parents=True, exist_ok=True)
    asset_id = uuid.uuid4().hex
    source = RASTER_DIR / f"{asset_id}-source{suffix}"
    target = RASTER_DIR / f"{asset_id}.tif"
    source.write_bytes(raw)
    original_name = Path(file.filename or "dataset").name
    uploaded_at = datetime.now(UTC).isoformat()
    object_key = f"rasters/{asset_id}.tif"
    try:
        spatial = await run_in_threadpool(convert_to_cog, source, target)
    except Exception as exc:
        source.unlink(missing_ok=True)
        target.unlink(missing_ok=True)
        failed_metadata = {"id": asset_id, "filename": original_name, "source": "user-upload", "source_format": suffix.lstrip("."), "size_bytes": len(raw), "uploaded_at": uploaded_at, "storage": "minio" if os.getenv("MINIO_ENDPOINT") else "local", "object_key": object_key, "processing_status": "failed", "processing_error": str(exc)[:300]}
        session.add(GriddedAssetRecord(id=asset_id, filename=original_name, source_format=suffix.lstrip("."), object_key=object_key, processing_status="failed", metadata_json=failed_metadata))
        session.commit()
        raise HTTPException(status_code=422, detail=f"Could not prepare a Cloud-Optimized GeoTIFF: {str(exc)[:300]}") from exc
    storage = "local"
    if os.getenv("MINIO_ENDPOINT"):
        try:
            await run_in_threadpool(upload_object, target, object_key, "image/tiff")
            await run_in_threadpool(upload_object, source, f"sources/{asset_id}{suffix}")
            storage = "minio"
        except Exception as exc:
            source.unlink(missing_ok=True)
            target.unlink(missing_ok=True)
            failed_metadata = {"id": asset_id, "filename": original_name, "source": "user-upload", "source_format": suffix.lstrip("."), "size_bytes": len(raw), "uploaded_at": uploaded_at, "storage": "minio", "object_key": object_key, "processing_status": "failed", "processing_error": f"MinIO upload failed: {str(exc)[:200]}"}
            session.add(GriddedAssetRecord(id=asset_id, filename=original_name, source_format=suffix.lstrip("."), object_key=object_key, processing_status="failed", metadata_json=failed_metadata))
            session.commit()
            raise HTTPException(status_code=502, detail=f"MinIO upload failed: {str(exc)[:200]}") from exc
    metadata = {"id": asset_id, "filename": original_name, "source": "user-upload", "source_format": suffix.lstrip("."), "size_bytes": len(raw), "uploaded_at": uploaded_at, "storage": storage, "object_key": object_key, "processing_status": "complete", **spatial, **_inspect_raster(target)}
    metadata["tile_url"] = f"/api/data/gridded/{asset_id}/tiles/{{z}}/{{x}}/{{y}}.png"
    target.with_suffix(target.suffix + ".json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    session.add(GriddedAssetRecord(id=asset_id, filename=metadata["filename"], source_format=suffix.lstrip("."), object_key=object_key, processing_status="complete", metadata_json=metadata))
    session.commit()
    return metadata


@app.get("/api/data/gridded")
def list_gridded_data(session: Session = Depends(get_session)) -> list[dict]:
    records = session.scalars(select(GriddedAssetRecord).order_by(GriddedAssetRecord.uploaded_at.desc())).all()
    assets = []
    for record in records:
        metadata = dict(record.metadata_json)
        metadata.setdefault("tile_url", f"/api/data/gridded/{record.id}/tiles/{{z}}/{{x}}/{{y}}.png")
        assets.append(metadata)
    return assets


@app.get("/api/data/gridded/{asset_id}/tiles/{z}/{x}/{y}.png")
def gridded_tile(asset_id: str, z: int, x: int, y: int) -> Response:
    if not re.fullmatch(r"[a-f0-9]{32}", asset_id):
        raise HTTPException(status_code=404, detail="GeoTIFF asset not found")
    path = next((candidate for suffix in (".tif", ".tiff") if (candidate := RASTER_DIR / f"{asset_id}{suffix}").is_file()), None)
    if path is None:
        raise HTTPException(status_code=404, detail="GeoTIFF asset not found")
    try:
        import numpy as np
        from rio_tiler.io import Reader

        with Reader(str(path)) as source:
            tile = source.tile(x, y, z, indexes=(1,))
        band = tile.data[0]
        mask = tile.mask[0] if tile.mask is not None and tile.mask.ndim == 3 else tile.mask
        valid_mask = np.isfinite(band)
        if mask is not None:
            valid_mask &= mask > 0
        if not valid_mask.any():
            raise HTTPException(status_code=404, detail="This map tile has no raster data")
        metadata_path = path.with_suffix(path.suffix + ".json")
        metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else {}
        if "display_min" in metadata and "display_max" in metadata:
            low, high = metadata["display_min"], metadata["display_max"]
        else:
            low, high = (float(value) for value in np.nanpercentile(band[valid_mask], (2, 98)))
        if high <= low:
            high = low + 1
        tile.rescale(((low, high),))
        return Response(content=tile.render(img_format="PNG"), media_type="image/png", headers={"Cache-Control": "public, max-age=300"})
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Could not render raster tile for %s", asset_id)
        raise HTTPException(status_code=422, detail="Raster tile could not be rendered; verify the GeoTIFF is georeferenced") from exc

