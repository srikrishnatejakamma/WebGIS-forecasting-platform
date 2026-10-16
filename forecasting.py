"""Transparent baseline rainfall-runoff model for the runnable starter."""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from models import ForecastPointRecord, ForecastRunRecord, ObservationRecord, StationRecord


MODEL_NAME = "rivercast-rainfall-runoff"
MODEL_VERSION = "0.1.0"


def create_forecast_run(session: Session, station: StationRecord, hours: int = 48) -> ForecastRunRecord:
    latest = session.scalar(
        select(ObservationRecord)
        .where(ObservationRecord.station_id == station.id)
        .order_by(ObservationRecord.observed_at.desc())
        .limit(1)
    )
    now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    base_flow = latest.discharge_m3s if latest else 0.0
    recent_rain = latest.rainfall_mm if latest else 0.0
    run = ForecastRunRecord(
        station_id=station.id,
        generated_at=now,
        model_name=MODEL_NAME,
        model_version=MODEL_VERSION,
        # The included model is uncalibrated even when a user imports measured
        # observations, so forecast output must remain labeled as demo data.
        is_demo_data=True,
        status="running",
    )
    session.add(run)
    session.flush()

    # Simple reservoir response model: rainfall adds runoff with a lag while
    # discharge recedes toward baseflow. Replace with a calibrated basin model
    # when catchment parameters and a real rainfall forecast are configured.
    flow = base_flow
    for hour in range(hours + 1):
        phase = (hour / 24 * math.tau) + (sum(map(ord, station.id)) % 17)
        rainfall = max(0.0, math.sin(phase / 1.6) * (recent_rain or 2.0))
        runoff = rainfall * max(station.alert_level_m3s * 0.0012, 0.4)
        flow = max(0.0, flow * 0.985 + runoff)
        session.add(
            ForecastPointRecord(
                run_id=run.id,
                valid_at=now + timedelta(hours=hour),
                discharge_m3s=round(flow, 2),
                rainfall_mm=round(rainfall, 2),
            )
        )
    run.status = "complete"
    session.flush()
    result = session.execute(
        select(ForecastRunRecord)
        .options(joinedload(ForecastRunRecord.points))
        .where(ForecastRunRecord.id == run.id)
    ).unique().scalar_one_or_none()
    return result or run

