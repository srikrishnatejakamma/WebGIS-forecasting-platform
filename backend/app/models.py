"""Persistent spatial, observation, and forecast entities."""

from __future__ import annotations

from datetime import datetime

from geoalchemy2 import Geometry
from geoalchemy2.elements import WKBElement
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class StationRecord(Base):
    __tablename__ = "stations"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    river: Mapped[str] = mapped_column(String(160), nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    location: Mapped[WKBElement] = mapped_column(Geometry("POINT", srid=4326, spatial_index=True), nullable=False)
    alert_level_m3s: Mapped[float] = mapped_column(Float, nullable=False)
    is_demo_data: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    observations: Mapped[list[ObservationRecord]] = relationship(back_populates="station", cascade="all, delete-orphan")
    forecast_runs: Mapped[list[ForecastRunRecord]] = relationship(back_populates="station", cascade="all, delete-orphan")


class ObservationRecord(Base):
    __tablename__ = "observations"
    __table_args__ = (
        Index("ix_observations_station_time", "station_id", "observed_at"),
        UniqueConstraint("station_id", "observed_at", name="uq_observation_station_time"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    station_id: Mapped[str] = mapped_column(ForeignKey("stations.id", ondelete="CASCADE"), nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    discharge_m3s: Mapped[float] = mapped_column(Float, nullable=False)
    rainfall_mm: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    source: Mapped[str] = mapped_column(String(200), default="demo", nullable=False)
    station: Mapped[StationRecord] = relationship(back_populates="observations")


class ForecastRunRecord(Base):
    __tablename__ = "forecast_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    station_id: Mapped[str] = mapped_column(ForeignKey("stations.id", ondelete="CASCADE"), nullable=False, index=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    model_name: Mapped[str] = mapped_column(String(160), default="rivercast-rainfall-runoff", nullable=False)
    model_version: Mapped[str] = mapped_column(String(40), default="0.1.0", nullable=False)
    is_demo_data: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="complete", nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    station: Mapped[StationRecord] = relationship(back_populates="forecast_runs")
    points: Mapped[list[ForecastPointRecord]] = relationship(back_populates="run", cascade="all, delete-orphan", order_by="ForecastPointRecord.valid_at")


class ForecastPointRecord(Base):
    __tablename__ = "forecast_points"
    __table_args__ = (Index("ix_forecast_points_run_valid", "run_id", "valid_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("forecast_runs.id", ondelete="CASCADE"), nullable=False)
    valid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    discharge_m3s: Mapped[float] = mapped_column(Float, nullable=False)
    rainfall_mm: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    run: Mapped[ForecastRunRecord] = relationship(back_populates="points")


class GriddedAssetRecord(Base):
    __tablename__ = "gridded_assets"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    source_format: Mapped[str] = mapped_column(String(20), nullable=False)
    object_key: Mapped[str] = mapped_column(String(500), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    processing_status: Mapped[str] = mapped_column(String(30), nullable=False)
    metadata_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
