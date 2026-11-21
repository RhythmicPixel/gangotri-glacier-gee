# Gangotri Glacier Clean-Ice Mapping with Google Earth Engine

This repository maps **clean glacier ice and snow** in the Gangotri Glacier system using a 2026 post-monsoon Sentinel-2 composite in Google Earth Engine (GEE). It uses the Normalized Difference Snow Index (NDSI), a red/SWIR ratio, Cloud Score+ cloud masking, and terrain variables derived from the Copernicus GLO-30 DEM.

The workflow produces:

- A classified raster of clean ice/snow, potential low-slope non-ice areas, and water.
- A vector boundary of the mapped clean-ice class.
- A per-glacier area table comparing NDSI, red/SWIR-ratio, and combined classification rules.

**Important:** This is not a complete glacier inventory. The workflow maps spectrally identifiable clean ice and snow; it does **not** directly detect debris-covered glacier ice, which is common in the lower ablation zone of Gangotri Glacier.

## Study area

The study area is based on selected glaciers from the Randolph Glacier Inventory (RGI) version 7.0.

| Glacier | Status in workflow |
|---|---|
| Gangotri | Included |
| Kirti | Included |
| Ghanohim | Included |
| Swachhand | Included |
| Maindi | Included |
| Sumeru | Included |
| Raktvarn | Excluded |
| Chaturangi | Excluded |

The selected RGI polygons are dissolved into a modified study-area boundary. A 2 km buffer around this boundary is used only for Sentinel-2 scene selection, compositing, and map display. All area calculations and exported outputs are restricted to the unbuffered modified boundary.

## What this workflow maps

| Class | Code | Interpretation |
|---|---:|---|
| Clean ice / snow | 1 | Pixels meeting the selected spectral ice/snow rule. This class may include both glacier ice and persistent seasonal snow. |
| Low-slope non-ice candidate | 2 | Non-ice, non-water pixels within the RGI boundary with slope below 24 degrees. This is **not** a validated debris-covered-ice class. |
| Water | 3 | Non-ice pixels with NDWI above 0.0. This is a preliminary water mask. |
| No data | NA | Cloud-masked, invalid, or otherwise unavailable pixels within the RGI boundary. |

The low-slope non-ice candidate layer may contain debris-covered ice, but it may also contain bedrock, moraine, sediment, valley-floor deposits, vegetation, shadows, and other non-glacier surfaces.

## Workflow

1. **Define the study area.**  
   Select glaciers from RGI v7.0 using their RGI IDs. The selected polygons are merged into a modified boundary, which is then buffered by 2 km for imagery selection and visualization.

2. **Acquire Sentinel-2 imagery.**  
   Use Sentinel-2 Level-2A Harmonized surface reflectance from 20 September to 31 October 2026. Scenes with a tile-level `CLOUDY_PIXEL_PERCENTAGE` of 10% or more are removed. Remaining clouds are masked at the pixel level using Cloud Score+.

3. **Pre-process imagery.**  
   Resample the 20 m SWIR band (B11) to 10 m using bilinear interpolation. Reproject all bands to UTM zone 44N (`EPSG:32644`) and clip to the buffered study-area boundary. Generate a median composite for the spectral bands.

4. **Calculate spectral indices.**  
   Compute:
   - NDSI: `(B3 - B11) / (B3 + B11)`
   - NDWI: `(B3 - B8) / (B3 + B8)`
   - Red/SWIR ratio: `B4 / B11`
   - False-colour composite: `B11-B8-B4`

5. **Reduce transient snow effects.**  
   Calculate the 25th percentile of NDSI across available scenes. This reduces the influence of short-lived snowfall events, although it cannot fully separate seasonal snow from glacier ice.

6. **Derive terrain variables.**  
   Reproject the Copernicus GLO-30 DEM to UTM zone 44N at its native 30 m resolution. Derive slope and hillshade. Hillshade uses the mean solar azimuth and solar elevation of the selected Sentinel-2 scenes.

7. **Classify clean ice/snow.**  
   Apply one of three rules:
   - `ndsi`: NDSI >= 0.4
   - `ratio`: B4/B11 >= 2.0
   - `both`: NDSI >= 0.4 **and** B4/B11 >= 2.0

   Remove connected clean-ice patches smaller than 100 pixels, equivalent to 0.01 km² at 10 m resolution.

8. **Identify preliminary water and non-ice candidates.**  
   Apply NDWI only to non-ice pixels because snow and ice can also have positive NDWI values. Identify low-slope non-ice, non-water pixels inside the RGI boundary as potential debris-cover candidates.

9. **Calculate areas and export results.**  
   Calculate area in km² for each class within each RGI polygon. Export the classified raster, area table, and clean-ice boundary to Google Drive.

## Data sources

| Dataset | Earth Engine asset ID | Role |
|---|---|---|
| Sentinel-2 Level-2A Harmonized | `COPERNICUS/S2_SR_HARMONIZED` | Optical imagery for spectral classification |
| Cloud Score+ | `GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED` | Pixel-level cloud masking |
| Copernicus DEM GLO-30 | `COPERNICUS/DEM/GLO30_2024_1` | Slope and hillshade |
| Randolph Glacier Inventory v7.0 | `projects/sat-io/open-datasets/RGI/RGI_VECTOR_MERGED_V7` | Study-area definition and per-glacier reporting units |

## Getting started

1. Sign in to the [Google Earth Engine Code Editor](https://code.earthengine.google.com/) using an account with Earth Engine access.
2. Create a new script.
3. Copy the contents of `scripts/gangotri_glacier_mapping.js` into the Code Editor.
4. Set the RGI IDs in the `GLACIERS` dictionary.
5. Run the script.
6. Review the printed scene count, glacier count, and area table.
7. Start the export tasks from the **Tasks** tab.
8. Check the exported files in the `GEE_Gangotri` folder in Google Drive.

## Configuration

All main parameters are defined at the top of `scripts/gangotri_glacier_mapping.js`.

| Parameter | Default | Description |
|---|---:|---|
| `GLACIERS` | Gangotri set | Glacier name-to-RGI-ID mapping. Empty IDs are skipped. |
| `START` | `2026-09-20` | Start date of the Sentinel-2 image window. |
| `END` | `2026-11-01` | Exclusive end date of the Sentinel-2 image window. |
| `MAX_CLOUD_PCT` | `10` | Maximum scene-level `CLOUDY_PIXEL_PERCENTAGE`. |
| `CLOUD_SCORE_MIN` | `0.6` | Minimum Cloud Score+ `cs_cdf` value for a valid pixel. |
| `CRS` | `EPSG:32644` | Analysis coordinate reference system: UTM zone 44N. |
| `SCALE` | `10` | Analysis resolution in metres. |
| `BUFFER_M` | `2000` | Buffer around the modified RGI boundary, in metres. |
| `NDSI_THRESHOLD` | `0.4` | NDSI threshold for clean ice/snow. |
| `NDSI_PERCENTILE` | `25` | Percentile of NDSI used in the multi-date composite. |
| `RATIO_THRESHOLD` | `2.0` | Red/SWIR ratio threshold for clean ice/snow. |
| `ICE_METHOD` | `ndsi` | Classification rule: `ndsi`, `ratio`, or `both`. |
| `WATER_NDWI_MIN` | `0.0` | NDWI threshold for preliminary water detection. |
| `MIN_PATCH_PX` | `100` | Minimum clean-ice patch size in pixels. |
| `DEBRIS_SLOPE_MAX` | `24` | Maximum slope, in degrees, for the low-slope non-ice candidate class. |
| `EXPORT_FOLDER` | `GEE_Gangotri` | Google Drive folder for exported outputs. |
| `EXPORT_TAG` | `Gangotri_2026` | Prefix applied to exported file names. |

## Outputs

All outputs are exported to the `GEE_Gangotri` folder in Google Drive and are clipped to the modified RGI boundary.

| Output | Format | Contents |
|---|---|---|
| `Gangotri_2026_classes` | GeoTIFF | Classified raster: `1` = clean ice/snow, `2` = low-slope non-ice candidate, `3` = water. |
| `Gangotri_2026_areas` | CSV | Per-glacier area statistics and analysis metadata. |
| `Gangotri_2026_boundary` | Shapefile | Polygonized clean-ice/snow class. |

### Area table fields

| Field | Meaning |
|---|---|
| `label` | Glacier name provided in the configuration. |
| `rgi_id` | RGI v7.0 identifier. |
| `rgi_area_km2` | RGI-reported glacier area; used only as a baseline/reference. |
| `clean_km2` | Clean ice/snow area under the selected `ICE_METHOD`. |
| `debris_candidate_km2` | Low-slope non-ice, non-water area within the RGI polygon; not validated debris-covered ice. |
| `water_km2` | Preliminary water area within the RGI polygon. |
| `nodata_km2` | Cloud-masked or otherwise invalid area within the RGI polygon. |
| `ndsi_km2` | Clean ice/snow area using the NDSI-only rule. |
| `ratio_km2` | Clean ice/snow area using the red/SWIR-ratio-only rule. |
| `ndsi_ratio_km2` | Clean ice/snow area using both NDSI and red/SWIR-ratio rules. |
| `ice_method` | Classification rule used for `clean_km2`. |
| `ndsi_threshold` | NDSI threshold used. |
| `ndsi_percentile` | NDSI percentile used. |
| `ratio_threshold` | Red/SWIR ratio threshold used. |
| `ndwi_min` | NDWI threshold used for water detection. |
| `start` | Start date of the image window. |
| `end` | End date of the image window. |
| `max_cloud_pct` | Scene-level cloud-cover threshold. |
| `scenes` | Number of Sentinel-2 scenes retained after filtering. |

## How to interpret the results

- `clean_km2` represents the area classified as clean ice or snow under the selected rule. It is **not** necessarily equivalent to total glacier area.
- `debris_candidate_km2` is an exclusion-based candidate layer. It should be interpreted as **potential debris-covered ice**, not mapped debris-covered glacier ice.
- `rgi_area_km2` is a static inventory baseline. It should not be interpreted as the glacier area in 2026.
- Differences between `clean_km2` and `rgi_area_km2` may result from seasonal snow, debris cover, cloud masking, classification thresholds, RGI boundary generalization, and differences between inventory and image dates.
- The NDSI, ratio, and combined-rule columns are intended for sensitivity analysis. Do not select a final classification rule without visual inspection and validation.


## Limitations

- **Debris-covered ice.** NDSI cannot directly detect debris-covered ice. Much of the lower ablation zone of Gangotri Glacier is debris-covered, so this workflow will underestimate total glacier extent. 
- **Snow–ice confusion.** NDSI identifies both snow and clean ice. The 25th-percentile NDSI composite reduces the influence of transient snow, but persistent seasonal snow can still be classified as clean ice/snow.
- **Red/SWIR threshold.** The B4/B11 threshold of 2.0 is an initial, unvalidated value. Its performance may vary with illumination, shadow, dust, surface roughness, and debris cover.
- **Cloud and shadow.** The scene-level cloud filter uses the cloud percentage for the full Sentinel-2 tile, not only the glacier area. Pixel-level Cloud Score+ masking reduces cloud contamination, but cloud shadow, steep terrain, and persistent cloud can still create data gaps.
- **Water detection.** NDWI is applied only to non-ice pixels. Turbid, shallow, or frozen water bodies may be missed, while some shadowed snow or ice may be incorrectly labelled as water.
- **RGI boundaries.** RGI polygons are used to define the study area and reporting units. They are not a 2026 glacier mask and should not be used alone for glacier-by-glacier area-change analysis.

## Repository structure

```text
gangotri-glacier-gee/
├── README.md
└── scripts/
    └── gangotri_glacier_mapping.js
```

## Data attribution

- Sentinel-2 Level-2A surface reflectance imagery: European Union Copernicus programme / European Space Agency.
- Cloud Score+: Google Earth Engine.
- Copernicus DEM GLO-30: European Space Agency / Copernicus programme.
- Randolph Glacier Inventory (RGI) version 7.0: RGI 7.0 Consortium (2023).

## Citation

If you use or adapt this workflow, please cite the underlying datasets and the Randolph Glacier Inventory:

> RGI 7.0 Consortium (2023). *Randolph Glacier Inventory: A Dataset of Global Glacier Outlines, Version 7.0.* 
