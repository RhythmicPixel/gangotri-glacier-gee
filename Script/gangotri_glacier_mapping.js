/**
 * Gangotri Glacier Mapping: Sentinel-2 NDSI and Copernicus DEM
 *
 * Maps glacier extent for Gangotri Glacier and its tributaries from a 2026
 * post-monsoon Sentinel-2 composite, and reports area per glacier.
 *
 * Workflow
 *   1. Select glaciers from RGI v7.0 and build the modified boundary
 *      (Raktvarn and Chaturangi are excluded ).
 *   2. Build a cloud-masked Sentinel-2 composite on a 10 m UTM 44N grid,
 *      clipped to the 2 km buffered boundary. Spectral bands use the median;
 *      NDSI uses a low percentile across scenes so transient snow drops out.
 *   3. Compute the FCC (B11-B8-B4), NDSI, NDWI, and the red/SWIR ratio.
 *   4. Derive hillshade and slope from the Copernicus GLO-30 DEM.
 *   5. Extract clean ice (NDSI, red/SWIR ratio, or both), water (NDWI), and a
 *      debris-covered candidate layer.
 *   6. Calculate area per glacier inside the RGI boundary, then export.
 *
 * Usage: paste into the Earth Engine Code Editor and run. Export tasks appear
 * in the Tasks tab. See the README for configuration and limitations.
 */

// -----------------------------------------------------------------------------
// 1. Configuration
// -----------------------------------------------------------------------------

// Datasets
var RGI_ASSET   = 'projects/sat-io/open-datasets/RGI/RGI_VECTOR_MERGED_V7';
var S2_ASSET    = 'COPERNICUS/S2_SR_HARMONIZED';
var CLOUD_ASSET = 'GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED';
var DEM_ASSET   = 'COPERNICUS/DEM/GLO30_2024_1';

// Glaciers in the study area, as RGI v7.0 IDs. Leave an ID empty ('') until it
// is known; the script then lists nearby RGI glaciers to help you find it.
var GLACIERS = {
  'Gangotri':  'RGI2000-v7.0-G-15-00467',
  'Kirti':     '',
  'Ghanohim':  '',
  'Swachhand': '',
  'Maindi':    '',
  'Sumeru':    ''
};

// Image selection
var START = '2026-09-20';
var END = '2026-11-01';           // exclusive upper bound
var MAX_CLOUD_PCT = 10;           // scene-level CLOUDY_PIXEL_PERCENTAGE limit
var CLOUD_SCORE_MIN = 0.6;        // pixel-level Cloud Score+ (cs_cdf) minimum

// Processing
var CRS = 'EPSG:32644';           // UTM zone 44N
var SCALE = 10;                   // analysis resolution (m)
var BUFFER_M = 2000;              

// Glacier extraction
var NDSI_THRESHOLD = 0.4;
var NDSI_PERCENTILE = 25;         // across scenes; lower = stricter on transient snow
var RATIO_THRESHOLD = 2.0;        // red/SWIR (B4 / B11) at or above this = ice
var ICE_METHOD = 'ndsi';          // 'ndsi', 'ratio' or 'both' (intersection)
var WATER_NDWI_MIN = 0.0;         // NDWI above this = water (lakes) in non-ice areas
var MIN_PATCH_PX = 100;           // minimum ice patch: 100 px at 10 m = 0.01 km2
var DEBRIS_SLOPE_MAX = 24;        // debris candidate slope limit (degrees)

// Export
var EXPORT_FOLDER = 'GEE_Gangotri';
var EXPORT_TAG = 'Gangotri_2026';

// -----------------------------------------------------------------------------
// 2. Study area
// -----------------------------------------------------------------------------

var rgi = ee.FeatureCollection(RGI_ASSET);

var names = Object.keys(GLACIERS);
var selectedNames = names.filter(function (n) { return GLACIERS[n] !== ''; });
var missingNames = names.filter(function (n) { return GLACIERS[n] === ''; });

var ids = selectedNames.map(function (n) { return GLACIERS[n]; });
var idToName = {};
selectedNames.forEach(function (n) { idToName[GLACIERS[n]] = n; });

var glaciers = rgi.filter(ee.Filter.inList('rgi_id', ids));
print('Glaciers found in RGI (expected ' + ids.length + '):', glaciers.size());

// Help locate missing IDs: list RGI glaciers inside the buffered main glacier.
if (missingNames.length > 0) {
  print('RGI IDs not set for: ' + missingNames.join(', '));
  var mainGlacier = rgi.filter(ee.Filter.eq('rgi_id', GLACIERS.Gangotri));
  var neighbours = rgi
    .filterBounds(mainGlacier.geometry().buffer(BUFFER_M, 10))
    .filter(ee.Filter.neq('rgi_id', GLACIERS.Gangotri))
    .sort('area_km2', false);
  print('Neighbouring RGI glaciers (largest first):', neighbours.limit(30));
}

var modifiedGeom = glaciers.geometry().dissolve(10);
var bufferedGeom = modifiedGeom.buffer(BUFFER_M, 10);
var insideRgi = ee.Image.constant(1).clip(modifiedGeom);

// -----------------------------------------------------------------------------
// 3. Sentinel-2 composite
// -----------------------------------------------------------------------------

var cloudScore = ee.ImageCollection(CLOUD_ASSET);

var s2 = ee.ImageCollection(S2_ASSET)
  .filterBounds(bufferedGeom)
  .filterDate(START, END)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', MAX_CLOUD_PCT))
  .linkCollection(cloudScore, ['cs_cdf']);

var sceneCount = s2.size();
print('Sentinel-2 scenes with cloud < ' + MAX_CLOUD_PCT + '%:', sceneCount);
print('Scenes used:', s2.sort('system:time_start').map(function (image) {
  return ee.Feature(null, {
    date: image.date().format('YYYY-MM-dd'),
    tile: image.get('MGRS_TILE'),
    tile_cloud_pct: image.get('CLOUDY_PIXEL_PERCENTAGE')
  });
}));

// Per scene: select bands, resample bilinear (B11 is 20 m natively), scale to
// reflectance, mask clouds, and add NDSI. resample() must precede arithmetic.
function prepare(image) {
  var reflectance = image.select(['B3', 'B4', 'B8', 'B11'])
    .resample('bilinear')
    .divide(10000)
    .updateMask(image.select('cs_cdf').gte(CLOUD_SCORE_MIN));
  return reflectance.addBands(
    reflectance.normalizedDifference(['B3', 'B11']).rename('NDSI'));
}

var prepared = s2.map(prepare);

// Spectral bands: median composite on the analysis grid.
var composite = prepared.select(['B3', 'B4', 'B8', 'B11']).median()
  .reproject({crs: CRS, scale: SCALE})
  .clip(bufferedGeom);

// NDSI: low percentile across scenes, so snow that is not present in most
// scenes (fresh snowfall) does not count as glacier ice.
var ndsi = prepared.select('NDSI')
  .reduce(ee.Reducer.percentile([NDSI_PERCENTILE]))
  .rename('NDSI')
  .reproject({crs: CRS, scale: SCALE})
  .clip(bufferedGeom);

var validData = ndsi.mask();

// -----------------------------------------------------------------------------
// 4. Spectral indices
// -----------------------------------------------------------------------------

var fcc = composite.select(['B11', 'B8', 'B4']);   // SWIR-NIR-Red
var ndwi = composite.normalizedDifference(['B3', 'B8']).rename('NDWI');
var ratio = composite.select('B4').divide(composite.select('B11')).rename('RATIO');

// -----------------------------------------------------------------------------
// 5. Terrain
// -----------------------------------------------------------------------------

var demCollection = ee.ImageCollection(DEM_ASSET);
var dem = demCollection
  .filterBounds(bufferedGeom)
  .select('DEM')
  .mosaic()
  .setDefaultProjection(demCollection.first().select('DEM').projection());

// Terrain is derived on the UTM grid at the DEM's native 30 m resolution.
var dem30 = dem.resample('bilinear').reproject({crs: CRS, scale: 30});
var slope = ee.Terrain.slope(dem30).rename('slope');

// Illuminate with the mean sun position of the scenes used in the composite.
var sunAzimuth = ee.Number(s2.aggregate_mean('MEAN_SOLAR_AZIMUTH_ANGLE'));
var sunElevation = ee.Number(90)
  .subtract(ee.Number(s2.aggregate_mean('MEAN_SOLAR_ZENITH_ANGLE')));
var hillshade = ee.Terrain.hillshade(dem30, sunAzimuth, sunElevation)
  .rename('hillshade');

// -----------------------------------------------------------------------------
// 6. Glacier extraction
// -----------------------------------------------------------------------------

// Remove isolated patches smaller than the minimum glacier size.
function removeSmallPatches(mask) {
  var size = mask.connectedPixelCount(MIN_PATCH_PX, true);
  return mask.updateMask(mask.and(size.gte(MIN_PATCH_PX)));
}

var ndsiIce = ndsi.gte(NDSI_THRESHOLD);
var ratioIce = ratio.gte(RATIO_THRESHOLD);

// All three rules are computed so their areas can be compared in the output
// table; ICE_METHOD selects the one used for the classification.
var iceByMethod = {
  ndsi:  removeSmallPatches(ndsiIce),
  ratio: removeSmallPatches(ratioIce),
  both:  removeSmallPatches(ndsiIce.and(ratioIce))
};
var cleanIce = iceByMethod[ICE_METHOD].rename('clean_ice');

// Non-ice pixels inside the RGI outline that have valid data.
var nonIce = insideRgi
  .updateMask(validData)
  .updateMask(cleanIce.unmask(0).eq(0));

// Water is only tested in non-ice pixels: snow and ice can also have a
// positive NDWI, so applying the water test everywhere would remove ice.
var water = nonIce.updateMask(ndwi.gt(WATER_NDWI_MIN)).rename('water');

// Debris-covered ice cannot be detected with NDSI. Candidate pixels are the
// non-ice, non-water, gently sloping pixels inside the RGI outline.
var debris = nonIce
  .updateMask(water.unmask(0).eq(0))
  .updateMask(slope.lt(DEBRIS_SLOPE_MAX))
  .rename('debris');

// Classes: 1 = clean ice, 2 = debris candidate, 3 = water.
var classes = ee.Image(0)
  .where(debris.unmask(0), 2)
  .where(water.unmask(0), 3)
  .where(cleanIce.unmask(0), 1)
  .selfMask()
  .rename('class')
  .toByte();

// -----------------------------------------------------------------------------
// 7. Area statistics
// -----------------------------------------------------------------------------

var pixelKm2 = ee.Image.pixelArea().divide(1e6);

function areaBand(mask, name) {
  return mask.unmask(0).multiply(pixelKm2).rename(name);
}

var areaStack = ee.Image.cat([
  areaBand(cleanIce, 'clean_km2'),
  areaBand(debris, 'debris_candidate_km2'),
  areaBand(water, 'water_km2'),
  // Cloud-masked area inside the RGI outline (data gaps).
  areaBand(validData.not().and(insideRgi), 'nodata_km2'),
  // Method comparison: clean ice area under each rule.
  areaBand(iceByMethod.ndsi, 'ndsi_km2'),
  areaBand(iceByMethod.ratio, 'ratio_km2'),
  areaBand(iceByMethod.both, 'ndsi_ratio_km2')
]);

// Per glacier. Only pixels inside each RGI polygon are counted; pixels in the
// buffer outside the polygons are not included in any area figure.
var perGlacier = areaStack.reduceRegions({
  collection: glaciers,
  reducer: ee.Reducer.sum(),
  crs: CRS,
  scale: SCALE,
  tileScale: 4
}).map(function (feature) {
  var id = ee.String(feature.get('rgi_id'));
  return feature.set({
    label: ee.Dictionary(idToName).get(id, id),
    rgi_area_km2: feature.get('area_km2'),
    // Run parameters, so every exported table documents how it was made.
    ice_method: ICE_METHOD,
    ndsi_threshold: NDSI_THRESHOLD,
    ndsi_percentile: NDSI_PERCENTILE,
    ratio_threshold: RATIO_THRESHOLD,
    ndwi_min: WATER_NDWI_MIN,
    start: START,
    end: END,
    max_cloud_pct: MAX_CLOUD_PCT,
    scenes: sceneCount
  });
});

var tableColumns = [
  'label', 'rgi_id', 'rgi_area_km2',
  'clean_km2', 'debris_candidate_km2', 'water_km2', 'nodata_km2',
  'ndsi_km2', 'ratio_km2', 'ndsi_ratio_km2',
  'ice_method', 'ndsi_threshold', 'ndsi_percentile', 'ratio_threshold',
  'ndwi_min', 'start', 'end', 'max_cloud_pct', 'scenes'
];
var areaTable = perGlacier.select(tableColumns, null, false);

print('Area per glacier (km2). clean_km2 is measured; debris_candidate_km2 is ' +
  'derived from the RGI outline; rgi_area_km2 is the RGI baseline:', areaTable);

print(ui.Chart.feature.byFeature(perGlacier, 'label',
    ['clean_km2', 'debris_candidate_km2', 'water_km2'])
  .setChartType('ColumnChart')
  .setOptions({
    title: 'Glacier area by class, 2026 (km2)',
    isStacked: true,
    colors: ['#2b8cbe', '#8c6d46', '#1a237e'],
    vAxis: {title: 'km2'},
    legend: {position: 'top'}
  }));

// -----------------------------------------------------------------------------
// 8. Map layers
// -----------------------------------------------------------------------------

Map.centerObject(modifiedGeom, 11);
Map.setOptions('SATELLITE');
Map.addLayer(fcc, {min: 0, max: 0.5, gamma: 1.3}, 'FCC (B11-B8-B4)', false);
Map.addLayer(ndsi, {
  min: -0.5, max: 1,
  palette: ['8c510a', 'f6e8c3', 'ffffff', '80cdc1', '01665e']
}, 'NDSI (percentile composite)', false);
Map.addLayer(ndwi, {min: -0.5, max: 0.5, palette: ['8c510a', 'ffffff', '2166ac']},
  'NDWI', false);
Map.addLayer(ratio, {min: 0, max: 4, palette: ['000000', 'ffffff']},
  'Red/SWIR ratio', false);
Map.addLayer(hillshade, {min: 0, max: 255}, 'Hillshade', false);
Map.addLayer(slope, {
  min: 0, max: 60,
  palette: ['white', 'yellow', 'orange', 'red']
}, 'Slope (deg)', false);
Map.addLayer(classes, {min: 1, max: 3, palette: ['00c8ff', 'b5651d', '1a237e']},
  'Classes (1 ice, 2 debris candidate, 3 water)');
Map.addLayer(glaciers.style({color: 'ffd400', fillColor: '00000000', width: 2}),
  {}, 'Modified RGI boundary');

// -----------------------------------------------------------------------------
// 9. Exports
// -----------------------------------------------------------------------------

// Exports are limited to the modified boundary. The buffer is used for
// detection and map display only.
var classesInside = classes.clip(modifiedGeom);

Export.image.toDrive({
  image: classesInside,
  description: EXPORT_TAG + '_classes',
  folder: EXPORT_FOLDER,
  region: modifiedGeom,
  crs: CRS,
  scale: SCALE,
  maxPixels: 1e10
});

Export.table.toDrive({
  collection: areaTable,
  description: EXPORT_TAG + '_areas',
  folder: EXPORT_FOLDER,
  fileFormat: 'CSV',
  selectors: tableColumns        // drops the default system: index and .geo columns
});

Export.table.toDrive({
  collection: classesInside.reduceToVectors({
    geometry: modifiedGeom,
    crs: CRS,
    scale: SCALE,
    geometryType: 'polygon',
    eightConnected: false,
    labelProperty: 'class',
    reducer: ee.Reducer.countEvery(),
    maxPixels: 1e10,
    tileScale: 4
  }),
  description: EXPORT_TAG + '_boundary',
  folder: EXPORT_FOLDER,
  fileFormat: 'SHP'
});
