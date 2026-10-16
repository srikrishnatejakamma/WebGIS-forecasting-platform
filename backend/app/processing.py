"""Raster and gridded-data preparation helpers."""

from __future__ import annotations

from pathlib import Path


def convert_to_cog(source: Path, output: Path, variable: str | None = None) -> dict:
    """Convert GeoTIFF, NetCDF, or GRIB data to a tiled COG and return metadata."""
    suffix = source.suffix.lower()
    if suffix in {".tif", ".tiff"}:
        import rasterio
        from rasterio.shutil import copy as rio_copy

        with rasterio.open(source) as dataset:
            if dataset.crs is None:
                raise ValueError("GeoTIFF must have a coordinate reference system")
            meta = {"crs": str(dataset.crs), "bounds": list(dataset.bounds), "width": dataset.width,
                    "height": dataset.height, "bands": dataset.count, "source_driver": dataset.driver}
        rio_copy(source, output, driver="COG", compress="DEFLATE", overview_resampling="AVERAGE")
        return meta

    import xarray as xr

    engine = "cfgrib" if suffix in {".grib", ".grb", ".grb2"} else None
    options = {"engine": engine} if engine else {}
    with xr.open_dataset(source, chunks="auto", **options) as dataset:
        candidates = [name for name, value in dataset.data_vars.items() if value.ndim >= 2]
        if not candidates:
            raise ValueError("No two-dimensional gridded variable was found")
        chosen = variable if variable in candidates else candidates[0]
        array = dataset[chosen]
        while array.ndim > 2:
            array = array.isel({array.dims[0]: 0})
        spatial_dims = array.dims[-2:]
        array = array.rio.set_spatial_dims(x_dim=spatial_dims[-1], y_dim=spatial_dims[-2], inplace=False)
        if not array.rio.crs:
            array = array.rio.write_crs("EPSG:4326", inplace=False)
        array.rio.to_raster(output, driver="COG", compress="DEFLATE", overview_resampling="AVERAGE")
        return {"variable": chosen, "variables": candidates, "dimensions": dict(dataset.sizes),
                "crs": str(array.rio.crs), "bounds": list(array.rio.bounds()),
                "width": int(array.rio.width), "height": int(array.rio.height)}
