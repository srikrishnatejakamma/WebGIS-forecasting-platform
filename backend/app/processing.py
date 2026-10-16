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
            tags = dataset.tags(1)
            meta = {"crs": str(dataset.crs), "bounds": list(dataset.bounds), "width": dataset.width,
                    "height": dataset.height, "bands": dataset.count, "source_driver": dataset.driver,
                    "units": tags.get("units"), "variable": tags.get("long_name") or tags.get("description")}
        rio_copy(source, output, driver="COG", compress="DEFLATE", overview_resampling="AVERAGE")
        return meta

    import rioxarray  # noqa: F401 - registers the .rio accessor on xarray objects
    import xarray as xr

    engine = "cfgrib" if suffix in {".grib", ".grb", ".grb2"} else None
    options = {"engine": engine} if engine else {}
    with xr.open_dataset(source, chunks="auto", **options) as dataset:
        candidates = [name for name, value in dataset.data_vars.items() if value.ndim >= 2]
        if not candidates:
            raise ValueError("No two-dimensional gridded variable was found")
        chosen = variable if variable in candidates else candidates[0]
        array = dataset[chosen]
        selected_coordinates = {}
        while array.ndim > 2:
            dim = array.dims[0]
            if dim in dataset.coords:
                value = dataset.coords[dim].values[0]
                selected_coordinates[dim] = str(value)
            array = array.isel({dim: 0})
        spatial_dims = array.dims[-2:]
        array = array.rio.set_spatial_dims(x_dim=spatial_dims[-1], y_dim=spatial_dims[-2], inplace=False)
        if not array.rio.crs:
            coordinate_names = {name.lower() for name in (*array.dims, *array.coords)}
            if {"lat", "lon"}.issubset(coordinate_names) or {"latitude", "longitude"}.issubset(coordinate_names):
                array = array.rio.write_crs("EPSG:4326", inplace=False)
            else:
                raise ValueError("The grid has no CRS; only latitude/longitude coordinates can default to EPSG:4326")
        array.rio.to_raster(output, driver="COG", compress="DEFLATE", overview_resampling="AVERAGE")
        return {"variable": chosen, "variable_long_name": array.attrs.get("long_name"),
                "units": array.attrs.get("units"), "selected_coordinates": selected_coordinates,
                "variables": candidates, "dimensions": dict(dataset.sizes),
                "crs": str(array.rio.crs), "bounds": list(array.rio.bounds()),
                "width": int(array.rio.width), "height": int(array.rio.height)}
