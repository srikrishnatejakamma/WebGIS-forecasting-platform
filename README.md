# RiverCast WebGIS Forecasting Platform

RiverCast is a local, Docker Compose based WebGIS for hydrological station observations, forecast runs, gridded data ingestion, and map visualization. The stack contains a React/OpenLayers frontend, FastAPI backend, PostGIS database, and MinIO object storage.

## Platform overview

![RiverCast dashboard](screenshots/rivercast-dashboard.png)

![RiverCast system architecture](screenshots/architecture.svg)

## Data workflow

![RiverCast data workflow](screenshots/data-workflow.svg)

## Start locally

Install Docker Desktop with Compose, then from this directory run:

```powershell
Copy-Item .env.example .env
# For shared or networked use, change the local sample passwords and API token in .env.
docker compose up --build -d
```

Open the frontend at <http://localhost:3000>. The API and Swagger docs are at <http://localhost:8000> and <http://localhost:8000/docs>. MinIO's console is at <http://localhost:9001> (local example credentials: `admin` / `password123`). PostgreSQL/PostGIS is exposed at `localhost:5432`. Compose persists database state, MinIO objects, and the backend's local raster cache in named volumes.

The optional **India air** map layer uses CPCB's hourly pollutant dataset through the Government of India's Open Data API. Create a free API key at [data.gov.in](https://www.data.gov.in/apis), add it to your local `.env` as `DATA_GOV_IN_API_KEY=...`, then run `docker compose up -d backend` to pass it to the backend. Without a key, the layer explains the setup requirement. CPCB's feed provides pollutant averages; RiverCast displays those source values and does not calculate an AQI.

To stop the stack, run `docker compose down`. To delete local database, object, and raster data too, run `docker compose down -v`.

## Features

- OpenLayers map with station markers, alert status, OpenStreetMap basemap, and optional raster overlays.
- Station click popups, browser location centering, and interactive geodesic distance/area measurement tools based on OpenLayers examples.
- Live map overlays: OpenStreetMap river and canal lines, next-hour precipitation heatmap, recent precipitation radar, GDACS tropical-cyclone alerts, public river gauges, and optional CPCB air-quality stations.
- Station creation and CSV/JSON observation import from the interface.
- Station-specific current weather from Open-Meteo with a 15-minute refresh; river discharge remains sourced from imported observations or visibly marked demo records.
- Station history, forecast curves, run status/history, and manual forecast execution.
- Scheduled forecast runs every six hours.
- GeoTIFF, NetCDF, and GRIB/GRIB2 upload, grid inspection, COG conversion, and XYZ PNG tiles.
- NOAA GFS 0.25° three-hour precipitation forecast downloads for India, refreshed every six hours and displayed as a gridded map layer.
- PostGIS entities for gauges, observations, forecast runs and points, and gridded asset provenance, including failed processing status.
- MinIO storage for original grid files and generated COGs.
- FastAPI Swagger documentation and health endpoint.

CSV observations must use this header (timestamps must include a timezone):

```csv
station_id,observed_at,discharge_m3s,rainfall_mm
ganga-patna,2026-10-16T10:00:00+00:00,20500,3.2
```

JSON imports accept an array of objects with those fields or an object containing an `observations` array. Station IDs in the import must already exist. Import batches validate before saving and update forecasts for affected stations.

Gridded uploads are limited to 200 MB. The first two-dimensional variable is selected for NetCDF/GRIB unless a variable is configured in the processing helper. Higher-dimensional arrays use the first index for each extra dimension. Grid inputs need georeferencing; coordinates explicitly named latitude/longitude can default to EPSG:4326. Uploaded assets include a tile URL when COG conversion succeeds.

The Data tab can download a regional GRIB2 precipitation forecast from [NOAA NCEP NOMADS GFS](https://nomads.ncep.noaa.gov/). RiverCast requests the APCP surface field for forecast hour 3 over 5–30°N, 67–98°E, converts it to a Cloud-Optimized GeoTIFF, and adds it to the map. The backend also refreshes this layer every six hours. The source cycle, valid time, region, and source URL are recorded with the asset. NOAA GFS precipitation is a weather forecast layer; it does not feed the synthetic discharge model. Access to NOAA NOMADS is required for download.

## API overview

- `GET /health`, `GET /api/health`
- `GET /api/stations`, `POST /api/stations`
- `GET /api/geo/stations`
- `GET /api/stations/{station_id}/observations?hours=168`
- `POST /api/observations/import` with CSV or JSON body
- `GET /api/stations/{station_id}/forecast?hours=48`
- `POST /api/forecast-runs?hours=48&station_id=...`
- `GET /api/forecast-runs`
- `POST /api/data/gridded` multipart upload; `GET /api/data/gridded`
- `POST /api/data/gridded/noaa-gfs` downloads and processes the latest available regional NOAA GFS precipitation GRIB2 file
- `GET /api/data/gridded/{asset_id}/tiles/{z}/{x}/{y}.png`
- `GET /api/live/stations`, `GET /api/live/rainfall`, `GET /api/live/radar`, `GET /api/live/cyclones`
- `GET /api/live/river-stations`, `GET /api/live/air-quality-stations`

When `API_WRITE_TOKEN` is non-empty, write operations require `X-API-Token` with that value. The frontend's Write token box retains the token in that browser tab only. The token is a shared local write gate; it is not a full user/role identity system.

## Project layout

```text
docker-compose.yml
backend/
  Dockerfile
  requirements.txt
  app/
    main.py          # API, validation, scheduler, and tile delivery
    database.py      # PostGIS connection and SQLAlchemy sessions
    models.py        # Stations, observations, forecast and grid metadata
    forecasting.py   # Replaceable baseline model
    live_data.py     # Cached Open-Meteo, RainViewer, and GDACS layers
    processing.py    # NetCDF/GRIB/GeoTIFF to COG pipeline
    storage.py       # MinIO/S3 client helpers
frontend/
  Dockerfile
  nginx.conf
  package.json
  src/App.jsx        # React dashboard and OpenLayers map
```

## Scope and operational notes

The included rainfall/runoff model is a transparent synthetic baseline. It is useful for exercising the end-to-end workflow, but it is uncalibrated and not suitable for operational warnings or emergency decisions. The seeded Indian river gauges and their discharge readings are illustrative; Open-Meteo supplies model weather at their coordinates and does not provide river-gauge discharge. The optional map overlays use Open-Meteo's next-hour precipitation model, RainViewer's recent radar frames, and GDACS tropical-cyclone alerts with published storm GIS geometry where available. RainViewer's public feed shows recent radar imagery, not a forward radar nowcast. Provider data may be delayed or unavailable; these overlays are not an official warning service. Attribute Open-Meteo, RainViewer, and GDACS when redistributing the application, and review each provider's current terms for your use.

The requirements document leaves the production study area, data providers and licenses, forecast variables, forecast horizon, ingestion frequency, model choice, user roles, retention, and service targets undecided. Those choices need domain configuration before production use. The local interface uses OpenStreetMap basemap tiles and requires internet access for them.
