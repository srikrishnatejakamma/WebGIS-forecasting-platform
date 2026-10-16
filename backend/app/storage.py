"""MinIO/S3 object storage helpers."""

from __future__ import annotations

import os
from pathlib import Path

import boto3
from botocore.exceptions import ClientError


def client():
    endpoint = os.getenv("MINIO_ENDPOINT", "localhost:9000")
    if not endpoint.startswith(("http://", "https://")):
        endpoint = f"http://{endpoint}"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=os.getenv("MINIO_ACCESS_KEY", "admin"),
        aws_secret_access_key=os.getenv("MINIO_SECRET_KEY", "password123"),
        region_name=os.getenv("AWS_DEFAULT_REGION", "us-east-1"),
    )


def ensure_bucket() -> None:
    s3 = client()
    bucket = os.getenv("MINIO_BUCKET", "forecast-data")
    try:
        s3.head_bucket(Bucket=bucket)
    except ClientError:
        s3.create_bucket(Bucket=bucket)


def upload(path: Path, key: str, content_type: str | None = None) -> None:
    extra = {"ContentType": content_type} if content_type else None
    client().upload_file(str(path), os.getenv("MINIO_BUCKET", "forecast-data"), key, ExtraArgs=extra or {})


def download(key: str, destination: Path) -> None:
    client().download_file(os.getenv("MINIO_BUCKET", "forecast-data"), key, str(destination))
