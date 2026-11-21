# Gangotri Glacier Mapping with Google Earth Engine

Maps the extent of Gangotri Glacier and its tributaries from a 2026 post-monsoon Sentinel-2 composite, using the Normalized Difference Snow Index (NDSI) and the Copernicus GLO-30 DEM. Outputs a classified raster, a boundary shapefile, and a per-tributary area table.

## Workflow

1. **Study area:** Select glaciers from the Randolph Glacier Inventory (RGI) v7.0 and build the modified boundary. Raktvarn and Chaturangi are excluded; Kirti, Ghanohim, Swachhand, Maindi and Sumeru are included. A Buffer of 2000 m is applied on the modified boundary.
2. **Imagery:** Sentinel-2 Level-2A (harmonized), 20 September to 31 October 2026. Scenes with cloud cover above 10% are dropped, and remaining clouds are masked per pixel with Cloud Score+.
3. **Pre-processing:** Resample B11 (20 m) to 10 m with bilinear interpolation, reproject to UTM zone 44N (EPSG:32644) and clip to the buffered boundary. Spectral bands use a median composite. NDSI uses a low percentile across scenes, so that fresh snowfall does not count as ice.
4. **Indices:** False colour composite (B11-B8-B4), NDSI = (B3 - B11) / (B3 + B11), NDWI = (B3 - B8) / (B3 + B8) and the red/SWIR ratio B4 / B11.
5. **Terrain:** Reproject the Copernicus DEM to UTM 44N and derive slope and hillshade.
6. **Extraction:** Clean ice where NDSI is 0.4 or higher, where the red/SWIR ratio is 2 or higher, or both (set with `ICE_METHOD`); patches under 0.01 km2 are removed. Water (lakes) is identified with NDWI in non-ice pixels, and a debris-covered candidate layer excludes it (see limitations).
7. **Statistics and export:** Area per glacier inside its RGI boundary, then export to Google Drive. The buffer is used for detection and map display only; exports and area figures cover the modified boundary.

## Data sources

| Data | Earth Engine ID |
| --- | --- |
| Sentinel-2 Level-2A | `COPERNICUS/S2_SR_HARMONIZED` |
| Cloud Score+ | `GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED` |
| Copernicus DEM GLO-30 | `COPERNICUS/DEM/GLO30_2024_1` |
| RGI v7.0 | `projects/sat-io/open-datasets/RGI/RGI_VECTOR_MERGED_V7` (Awesome GEE Community Catalog) |

## Getting started

1. Sign in to the [Earth Engine Code Editor](https://code.earthengine.google.com/) with an account that has Earth Engine access.
2. Paste `scripts/gangotri_glacier_mapping.js` into a new script.
3. Set the RGI IDs in the `GLACIERS` dictionary.
4. Run the script, then start the export tasks from the **Tasks** tab.

## Configuration

All parameters are at the top of the script.

| Parameter | Default | Description |
| --- | --- | --- |
| `GLACIERS` | Gangotri set | Glacier name to RGI v7.0 ID. Empty IDs are skipped. |
| `START`, `END` | 2026-09-20, 2026-11-01 | Image window (end date is exclusive). |
| `MAX_CLOUD_PCT` | 10 | Scene-level cloud cover limit (%). |
| `CLOUD_SCORE_MIN` | 0.6 | Minimum Cloud Score+ `cs_cdf` for a valid pixel. |
| `CRS`, `SCALE` | EPSG:32644, 10 | Analysis grid. |
| `BUFFER_M` | 2000 | Buffer around the modified boundary (m). |
| `NDSI_THRESHOLD` | 0.4 | NDSI cut-off for ice. |
| `NDSI_PERCENTILE` | 25 | Percentile of NDSI across scenes; lower values are stricter about transient snow. |
| `RATIO_THRESHOLD` | 2.0 | Red/SWIR (B4 / B11) cut-off for ice. |
| `ICE_METHOD` | `ndsi` | Rule used for the classification: `ndsi`, `ratio` or `both` (intersection). |
| `WATER_NDWI_MIN` | 0.0 | NDWI above this marks water in non-ice pixels. |
| `MIN_PATCH_PX` | 100 | Minimum patch size in pixels (0.01 km2 at 10 m). |
| `DEBRIS_SLOPE_MAX` | 24 | Slope limit for debris candidates (degrees). |

## Outputs

Exported to the `GEE_Gangotri` Drive folder, all limited to the modified boundary:

- `Gangotri_2026_classes`: GeoTIFF, 1 = clean ice, 2 = debris candidate, 3 = water.
- `Gangotri_2026_areas`: CSV with area (km2) per glacier: clean ice, debris candidate, water, no-data, and the clean-ice area under each rule (`ndsi_km2`, `ratio_km2`, `ndsi_ratio_km2`), next to the RGI baseline area.
- `Gangotri_2026_boundary`: shapefile of the polygons.

## Limitations

- **Debris cover.** NDSI cannot detect debris-covered ice, and much of Gangotri's lower ablation zone is debris-covered. It is not an independent mapping, so it is reported separately from the measured clean-ice area, and the terminus should be checked against high-resolution imagery or digitized manually.
- **Water mask.** NDWI is applied only to non-ice pixels, because snow and ice can also have a positive NDWI. Turbid or frozen lakes may be missed.
- **Ratio threshold.** The red/SWIR threshold of 2 is a commonly used starting value, not a validated one for this site. 
- **Scene cloud filter.** `CLOUDY_PIXEL_PERCENTAGE` is measured over the whole Sentinel-2 tile, not over the glacier. The pixel-level mask covers the glacier itself. Check the printed scene count, since a strict limit can leave very few scenes.
- **RGI baseline.** The RGI outlines are a baseline for the study area, not a time series. The RGI v7 user guide advises against using them for glacier-by-glacier area change.

## Repository structure

```
gangotri-glacier-gee/
├── README.md
└── scripts/
    └── gangotri_glacier_mapping.js
```

## Data attribution

- Sentinel-2 Level-2A and Copernicus DEM Global 30 m.
- RGI v7.0: RGI 7.0 Consortium (2023). Randolph Glacier Inventory, Version 7. 
