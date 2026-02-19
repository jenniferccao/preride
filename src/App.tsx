import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import './App.css';
import sampleRoute from './data/sampleRoute.geojson';
import { useMultiPointWindData } from './hooks/useWindData';
import type { HourlyWindEntry } from './hooks/useWindData';
import {
  loadArrowPoint, pooled, buildGridPoints, buildArrowsGeoJSON,
} from './hooks/windArrows';
import type { GridPoint } from './hooks/windArrows';
import { sampleElevations } from './hooks/elevationCache';

import TimeSlider from './components/TimeSlider';
import RouteDebugPanel from './components/RouteDebugPanel';
import type { DebugSegmentStats } from './components/RouteDebugPanel';


// ─── Map layer IDs ────────────────────────────────────────────────────────────
const DEM_SOURCE_ID = 'mapbox-dem';
const SKY_LAYER_ID = 'sky';
const ROUTE_SOURCE_ID = 'route';
const ROUTE_LAYER_ID = 'route-line';
const WIND_ARROWS_SOURCE = 'wind-arrows';
const WIND_ARROWS_LAYER = 'wind-arrows-layer';
const ARROW_IMAGE_ID = 'wind-arrow-icon';

// ─── Route geometry (extracted once from static import) ──────────────────────
const ROUTE_COORDS: number[][] =
  (
    (sampleRoute as GeoJSON.FeatureCollection).features.find(
      (f) => f.geometry.type === 'LineString',
    )?.geometry as GeoJSON.LineString | undefined
  )?.coordinates ?? [];

/** Pick n evenly-spaced points along the route for wind sampling. */
function sampleRoutePoints(coords: number[][], n: number): { lat: number; lon: number }[] {
  if (coords.length === 0) return [];
  return Array.from({ length: n }, (_, i) => {
    const idx = Math.round((i / Math.max(n - 1, 1)) * (coords.length - 1));
    const [lng, lat] = coords[Math.min(idx, coords.length - 1)];
    return { lat, lon: lng };
  });
}

// ─── Arrow grid config ─────────────────────────────────────────────────────
const ARROW_COLS = 6;   // per-viewport grid columns
const ARROW_ROWS = 4;   // per-viewport grid rows
const ARROW_CONCURRENCY = 6;   // max simultaneous Open-Meteo requests

// ─── Arrow icon ───────────────────────────────────────────────────────────────
/**
 * Draw a solid-color arrow and return it as ImageData for map.addImage.
 * We avoid SDF mode (unreliable across Mapbox GL JS versions) and draw
 * the color directly so the icon is always visible.
 */
function createArrowImage(size = 40): { width: number; height: number; data: Uint8ClampedArray } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;

  // Outer glow / drop-shadow for visibility on satellite imagery
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 4;

  // Solid sky-blue
  ctx.fillStyle = '#7dd3fc'; // sky-blue

  // Arrow shape: head (wide triangle) + tail (narrow shaft)
  ctx.beginPath();
  ctx.moveTo(cx, 3);           // tip
  ctx.lineTo(cx + 9, 18);           // right wing
  ctx.lineTo(cx + 3, 15);           // inner right
  ctx.lineTo(cx + 3, size - 3);     // bottom right
  ctx.lineTo(cx - 3, size - 3);     // bottom left
  ctx.lineTo(cx - 3, 15);           // inner left
  ctx.lineTo(cx - 9, 18);           // left wing
  ctx.closePath();
  ctx.fill();

  // White outline for contrast against satellite imagery
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const imageData = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data: imageData.data };
}

// ─── Bearing, distance & headwind math ──────────────────────────────────────

/** Great-circle bearing from point A → point B, in degrees 0-360. */
function computeBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(lng2 - lng1);
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const y = Math.sin(dLng) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLng);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

/** Smallest unsigned angle (0-180°) between two bearings. */
function smallestAngle(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Headwind component for a segment with the given travel bearing.
 *   windFromDeg = meteorological "from" direction (0° = from north).
 *   Positive return = headwind, negative = tailwind.
 */
function headwindComponent(bearing: number, windFromDeg: number, windSpeedKmh: number): number {
  const theta = smallestAngle(bearing, windFromDeg);
  return windSpeedKmh * Math.cos((theta * Math.PI) / 180);
}

/** Haversine distance between two lat/lng points, in metres. */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Parse a GPX file text into a [lng, lat] coordinate array.
 * Picks the largest track-segment by point count.
 * Throws a user-readable Error on failure.
 */
function parseGpx(text: string): number[][] {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid XML — file may not be a GPX');

  // Collect all trkpts from all tracks (prefer <trk>/<trkseg>/<trkpt>)
  const trkpts = Array.from(doc.querySelectorAll('trkpt'));
  const rtepts = trkpts.length === 0 ? Array.from(doc.querySelectorAll('rtept')) : [];
  const allPts = trkpts.length > 0 ? trkpts : rtepts;

  if (allPts.length === 0) throw new Error('No track or route points found in GPX');

  // If multiple <trk> blocks, group per-track and pick the largest
  const tracks = Array.from(doc.querySelectorAll('trk'));
  let chosenPts: Element[] = allPts;
  if (tracks.length > 1) {
    const groups = tracks.map((trk) => Array.from(trk.querySelectorAll('trkpt')));
    chosenPts = groups.reduce((a, b) => (b.length > a.length ? b : a));
  }

  const coords: number[][] = chosenPts
    .map((pt) => {
      const lat = parseFloat(pt.getAttribute('lat') ?? '');
      const lon = parseFloat(pt.getAttribute('lon') ?? '');
      return [lon, lat];
    })
    .filter(([lng, lat]) => isFinite(lng) && isFinite(lat));

  if (coords.length < 2) throw new Error('GPX track has fewer than 2 valid points');
  return coords;
}

/** Index of the nearest sample point to a given segment midpoint. */
function nearestSampleIndex(
  midLat: number,
  midLng: number,
  pts: { lat: number; lon: number }[],
): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = (pts[i].lat - midLat) ** 2 + (pts[i].lon - midLng) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Build GeoJSON FeatureCollection for the route with per-segment suffer scores.
 *
 * Suffer score formula (when includeElevation = true):
 *   sufferRaw = max(0, headwind_kmh) + K * max(0, grade)
 *
 * K = 40: wind is in km/h; a 10% (0.10) grade adds 4 km/h-equivalent effort.
 * This makes a steep road (≥8% grade) clearly visible even against sub-5 km/h headwind,
 * while still letting strong headwinds dominate on flat terrain.
 *
 * grade = (elevB - elevA) / segmentDistanceMeters, clamped to [-0.2, 0.2].
 * Only uphill (positive grade) contributes; descents are free.
 *
 * Scores are normalised to 0..1 across all segments for colour-mapping.
 */
const CLIMB_K = 80;
const GRADE_CLAMP = 0.2; // ±20% max grade before clamping
const OFFSET_METERS = 5;

// Simple flat-earth approximation for small offsets
function offsetPoint(lat: number, lon: number, bearingDeg: number, distMeters: number): [number, number] {
  const perpRad = ((bearingDeg + 90) * Math.PI) / 180;
  // dy is north/south change in meters
  // dx is east/west change in meters
  const dy = distMeters * Math.cos(perpRad);
  const dx = distMeters * Math.sin(perpRad);

  const latOffset = dy / 111111;
  const lonOffset = dx / (111111 * Math.cos((lat * Math.PI) / 180));

  return [lon + lonOffset, lat + latOffset];
}

function buildSegmentCollection(
  coords: number[][],
  samplePoints: { lat: number; lon: number }[],
  allData: (HourlyWindEntry[] | null)[],
  hourIndex: number,
  elevations: number[],        // one elevation (m) per route point; [] = unavailable
  includeElevation: boolean,
): GeoJSON.FeatureCollection {
  if (coords.length < 2) return { type: 'FeatureCollection', features: [] };

  const hasElev = includeElevation && elevations.length === coords.length;

  // Pre-pass: Count traversals per undirected edge to detect overlaps
  const edgeCounts = new Map<string, number>();
  // Key generator: sorted endpoints to be direction-agnostic
  const getEdgeKey = (p1: number[], p2: number[]) => {
    // Round to 5 decimals to fuzz match
    const k1 = `${p1[1].toFixed(5)},${p1[0].toFixed(5)}`;
    const k2 = `${p2[1].toFixed(5)},${p2[0].toFixed(5)}`;
    return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
  };

  for (let i = 0; i < coords.length - 1; i++) {
    const key = getEdgeKey(coords[i], coords[i + 1]);
    edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
  }

  const edgeVisited = new Map<string, number>();

  // Main pass: compute values and apply offsets
  const segmentData: (DebugSegmentStats & {
    coords: number[][]; // [start, end]
  })[] = [];

  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    const midLat = (lat1 + lat2) / 2;
    const midLng = (lng1 + lng2) / 2;
    const bearing = computeBearing(lat1, lng1, lat2, lng2);

    const nearestIdx = samplePoints.length > 0
      ? nearestSampleIndex(midLat, midLng, samplePoints)
      : 0;
    const entry = allData[nearestIdx]?.[hourIndex] ?? null;

    const hw = entry ? headwindComponent(bearing, entry.direction_deg, entry.speed_kmh) : 0;
    const headwindRaw = Math.max(0, hw);

    let climbPenalty = 0;
    let grade = 0;

    if (hasElev) {
      const distM = haversineMeters(lat1, lng1, lat2, lng2);
      if (distM > 0.1) { // ignore micro-segments
        const rawGrade = (elevations[i + 1] - elevations[i]) / distM;
        const g = Math.max(-GRADE_CLAMP, Math.min(GRADE_CLAMP, rawGrade));
        if (g > 0) {
          grade = g;
          climbPenalty = CLIMB_K * grade;
        } else {
          grade = g; // keep negative grade for debug info, but climbPenalty stays 0
        }
      }
    }

    const sufferRaw = headwindRaw + climbPenalty;

    // Apply offset if this segment is part of a bidirectional path
    const edgeKey = getEdgeKey(coords[i], coords[i + 1]);
    const totalVisits = edgeCounts.get(edgeKey) || 1;
    let finalCoords = [coords[i], coords[i + 1]];

    if (totalVisits > 1) {
      const visitsSoFar = edgeVisited.get(edgeKey) || 0;
      edgeVisited.set(edgeKey, visitsSoFar + 1);

      // First traversal = Offset +1 (Forward), Second = Offset -1 (Reverse)
      // Note: We use +1 for first encounter. 
      const sign = visitsSoFar === 0 ? 1 : -1;

      const p1 = offsetPoint(lat1, lng1, bearing, sign * OFFSET_METERS);
      const p2 = offsetPoint(lat2, lng2, bearing, sign * OFFSET_METERS);
      finalCoords = [p1, p2];
    }

    segmentData.push({
      headwindRaw,
      grade,
      climbPenalty,
      sufferRaw,
      totalScore: 0, // placeholder, computed after maxRaw
      coords: finalCoords,
    });
  }

  // Normalise to 0..1
  const raws = segmentData.map(s => s.sufferRaw);
  const maxRaw = Math.max(...raws, 1e-6);

  const features: GeoJSON.Feature<GeoJSON.LineString>[] = segmentData.map((seg) => ({
    type: 'Feature',
    properties: {
      score: seg.sufferRaw / maxRaw,
      headwindRaw: seg.headwindRaw,
      grade: seg.grade,
      climbPenalty: seg.climbPenalty,
      sufferRaw: seg.sufferRaw,
      totalScore: seg.sufferRaw / maxRaw,
    },
    geometry: { type: 'LineString', coordinates: seg.coords },
  }));

  return { type: 'FeatureCollection', features };
}

// ─── Component ────────────────────────────────────────────────────────────────
function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [terrainOn, setTerrainOn] = useState(true);
  const [windOn, setWindOn] = useState(true);
  const [elevationOn, setElevationOn] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [hourIndex, setHourIndex] = useState(0);


  // Active route coordinates (default = bundled sample route; replaced on GPX upload)
  const [routeCoords, setRouteCoords] = useState<number[][]>(ROUTE_COORDS);
  const [gpxError, setGpxError] = useState<string | null>(null);

  // Debug hover state
  const [hoveredSegment, setHoveredSegment] = useState<{
    stats: DebugSegmentStats;
    mousePos: { x: number; y: number };
  } | null>(null);

  // Cached per-point elevations (sampled once per route load; time-invariant)
  const cachedElevationsRef = useRef<number[]>([]);

  // Evenly-spaced sample points for wind fetching (recomputed when route changes)
  const N_SAMPLES = 10; // Number of points to sample along the route
  const samplePoints = useMemo(
    () => sampleRoutePoints(routeCoords, N_SAMPLES),
    [routeCoords],
  );

  // Multi-point wind data: N samples fetched in parallel, cached per-point
  const { allData, loading: windLoading } = useMultiPointWindData(samplePoints);

  // For WindInfoPanel: midpoint sample (REMOVED)
  const midIdx = Math.floor(samplePoints.length / 2);

  // Refs used inside event handlers (avoids stale closures)
  const windOnRef = useRef(windOn);
  const elevationOnRef = useRef(elevationOn);
  const hourIndexRef = useRef(hourIndex);
  const arrowGridRef = useRef<GridPoint[]>([]);
  const refreshArrowsRef = useRef<() => Promise<void>>(async () => { });
  useEffect(() => { windOnRef.current = windOn; }, [windOn]);
  useEffect(() => { elevationOnRef.current = elevationOn; }, [elevationOn]);
  useEffect(() => { hourIndexRef.current = hourIndex; }, [hourIndex]);

  // ── Async function: fetch missing arrow points and update source ───────────────────────
  const refreshArrows = useCallback(async () => {
    const m = map.current;
    if (!m || !windOnRef.current) return;
    const bounds = m.getBounds();
    if (!bounds) return;

    const pts = buildGridPoints(bounds, ARROW_COLS, ARROW_ROWS);
    arrowGridRef.current = pts;

    // Fetch only points not yet in the arrow cache (with concurrency limiter)
    // Use the exported loadArrowPoint which self-checks the cache
    await pooled(
      pts.map((p) => () => loadArrowPoint(p.lat, p.lng)),
      ARROW_CONCURRENCY,
    );

    const src = m.getSource(WIND_ARROWS_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(buildArrowsGeoJSON(pts, hourIndexRef.current));
    if (m.getLayer(WIND_ARROWS_LAYER)) {
      m.setLayoutProperty(WIND_ARROWS_LAYER, 'visibility', 'visible');
    }
  }, []);

  // Keep ref up to date so event handlers always call the latest version
  refreshArrowsRef.current = refreshArrows;

  // ── Map initialisation ────────────────────────────────────────────────────
  useEffect(() => {
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token) {
      setError('Missing VITE_MAPBOX_TOKEN environment variable.');
      return;
    }
    if (map.current) return;

    mapboxgl.accessToken = token;

    try {
      if (!mapContainer.current) return;

      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center: [-79.3832, 43.6532],
        zoom: 10,
        pitch: 45,
      });

      map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

      map.current.on('load', () => {
        const m = map.current!;

        // Register arrow icon (plain color, no SDF needed)
        m.addImage(ARROW_IMAGE_ID, createArrowImage(40));

        // ── Route: add source using pre-extracted ROUTE_COORDS ────────────
        m.addSource(ROUTE_SOURCE_ID, {
          type: 'geojson',
          // All-zero scores initially; recolor effect fills in once data arrives.
          // Elevation not yet available at init time — sampled in a separate effect.
          data: buildSegmentCollection(routeCoords, samplePoints, [], 0, [], false),
        });

        m.addLayer({
          id: ROUTE_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': [
              'interpolate', ['linear'], ['get', 'score'],
              0, '#22c55e',
              0.5, '#eab308',
              1, '#ef4444',
            ],
            'line-width': 5,
            'line-opacity': 0.9,
          },
        });

        setMapReady(true);

        // ── Debug hover on route line ─────────────────────────────────────────
        m.on('mousemove', ROUTE_LAYER_ID, (e) => {
          if (!e.features || e.features.length === 0) return;
          const props = e.features[0].properties;
          if (!props) return;

          setHoveredSegment({
            stats: {
              headwindRaw: props.headwindRaw,
              grade: props.grade,
              climbPenalty: props.climbPenalty,
              sufferRaw: props.sufferRaw,
              totalScore: props.score,
            },
            mousePos: e.point,
          });

          m.getCanvas().style.cursor = 'crosshair';
        });

        m.on('mouseleave', ROUTE_LAYER_ID, () => {
          setHoveredSegment(null);
          m.getCanvas().style.cursor = '';
        });
      });

      // ── moveend + zoomend: spatial wind re-fetch  ────────────────────────
      const onViewChanged = () => { void refreshArrowsRef.current(); };
      map.current.on('moveend', onViewChanged);
      map.current.on('zoomend', onViewChanged);


    } catch (err) {
      console.error('Error initialising map:', err);
      setError('Failed to initialise map. Check console for details.');
    }

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // ── Terrain ───────────────────────────────────────────────────────────────
  const enableTerrain = useCallback(() => {
    const m = map.current;
    if (!m) return;
    if (!m.getSource(DEM_SOURCE_ID)) {
      m.addSource(DEM_SOURCE_ID, {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      });
    }
    m.setTerrain({ source: DEM_SOURCE_ID, exaggeration: 1.3 });
    if (!m.getLayer(SKY_LAYER_ID)) {
      m.addLayer({
        id: SKY_LAYER_ID,
        type: 'sky',
        paint: {
          'sky-type': 'atmosphere',
          'sky-atmosphere-sun': [0.0, 0.0],
          'sky-atmosphere-sun-intensity': 15,
        },
      });
    } else {
      m.setLayoutProperty(SKY_LAYER_ID, 'visibility', 'visible');
    }
  }, []);

  const disableTerrain = useCallback(() => {
    const m = map.current;
    if (!m) return;
    m.setTerrain(null);
    if (m.getLayer(SKY_LAYER_ID)) {
      m.setLayoutProperty(SKY_LAYER_ID, 'visibility', 'none');
    }
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    if (terrainOn) enableTerrain(); else disableTerrain();
  }, [mapReady, terrainOn, enableTerrain, disableTerrain]);

  // ── Sample elevations after map is idle (terrain tiles fully loaded) ─────
  // BUG FIX: queryTerrainElevation returns 0/null until the DEM raster tiles
  // covering the route viewport are fetched. Calling it synchronously right
  // after setTerrain() (or mapReady) means tiles haven't arrived yet.
  // Solution: schedule sampling in a one-shot 'idle' listener so we only
  // sample once the map has finished loading all pending tiles.
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady || routeCoords.length < 2) return;

    // Step 2: DEM source guard
    if (!m.getSource(DEM_SOURCE_ID)) {
      console.error('[Elevation] DEM source missing — attempting to add it');
      try {
        m.addSource(DEM_SOURCE_ID, {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14,
        });
      } catch (_) { /* already exists */ }
    }

    // Ensure terrain is set so DEM tiles start loading
    if (!m.getTerrain()) {
      console.warn('[Elevation] Terrain not active — forcing setTerrain for elevation sampling');
      m.setTerrain({ source: DEM_SOURCE_ID, exaggeration: 1 });
    }

    const doSample = () => {
      const elevs = sampleElevations(m, routeCoords);
      cachedElevationsRef.current = elevs;
      // Force recolor with fresh elevations
      const src = m.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      if (src) {
        src.setData(
          buildSegmentCollection(
            routeCoords, samplePoints, allData, hourIndex,
            elevs, elevationOn,
          ),
        );
      }
    };

    // If map is already idle (all tiles loaded), sample immediately;
    // otherwise wait for the next idle event so DEM tiles are ready.
    if (m.loaded()) {
      doSample();
    } else {
      m.once('idle', doSample);
    }

    return () => {
      m.off('idle', doSample);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, routeCoords, terrainOn]); // terrainOn: re-sample after terrain toggled

  // ── Recolor route on wind data, hour, route change, or elevation toggle ──
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady) return;
    const src = m.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(
      buildSegmentCollection(
        routeCoords, samplePoints, allData, hourIndex,
        cachedElevationsRef.current, elevationOn,
      ),
    );
  }, [mapReady, allData, hourIndex, routeCoords, samplePoints, elevationOn]);

  // ── Auto-zoom when route changes (GPX upload) ─────────────────────────────
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady || routeCoords.length < 2) return;
    const bounds = routeCoords.reduce(
      (b, [lng, lat]) => b.extend([lng, lat] as [number, number]),
      new mapboxgl.LngLatBounds(
        routeCoords[0] as [number, number],
        routeCoords[0] as [number, number],
      ),
    );
    m.fitBounds(bounds, { padding: 60, duration: 1000 });
  }, [mapReady, routeCoords]);

  // ── Wind arrows: layer setup + data refresh ─────────────────────────────
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady) return;

    if (!windOn) {
      if (m.getLayer(WIND_ARROWS_LAYER)) {
        m.setLayoutProperty(WIND_ARROWS_LAYER, 'visibility', 'none');
      }
      return;
    }

    // Create source + layer once (empty data; refreshArrows fills it in)
    if (!m.getSource(WIND_ARROWS_SOURCE)) {
      const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
      m.addSource(WIND_ARROWS_SOURCE, { type: 'geojson', data: empty });
      try {
        m.addLayer(
          {
            id: WIND_ARROWS_LAYER,
            type: 'symbol',
            source: WIND_ARROWS_SOURCE,
            layout: {
              'icon-image': ARROW_IMAGE_ID,
              'icon-rotate': ['get', 'iconRotate'],
              'icon-size': ['get', 'iconSize'],
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-rotation-alignment': 'map',
            },
            paint: { 'icon-opacity': 0.92 },
          },
          ROUTE_LAYER_ID,
        );
      } catch (err) {
        console.error('[WindArrows] addLayer failed:', err);
      }
    } else {
      m.setLayoutProperty(WIND_ARROWS_LAYER, 'visibility', 'visible');
    }

    // Fetch + render for current viewport
    void refreshArrows();
  }, [mapReady, windOn, refreshArrows]);

  // ── Slider change: rebuild from cache (no network) ────────────────────────
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady || !windOn || arrowGridRef.current.length === 0) return;
    const src = m.getSource(WIND_ARROWS_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(buildArrowsGeoJSON(arrowGridRef.current, hourIndex));
  }, [mapReady, windOn, hourIndex]);

  // ── GPX upload ────────────────────────────────────────────────────────────
  const handleGpxUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // allow re-upload of the same file
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const coords = parseGpx(ev.target?.result as string);
        setRouteCoords(coords);
        setGpxError(null);
      } catch (err) {
        setGpxError(err instanceof Error ? err.message : 'Failed to parse GPX');
      }
    };
    reader.onerror = () => setGpxError('Failed to read file');
    reader.readAsText(file);
  }, []);

  // ── Route zoom ────────────────────────────────────────────────────────────
  const handleZoomToRoute = useCallback(() => {
    const m = map.current;
    if (!m || routeCoords.length < 2) return;
    const bounds = routeCoords.reduce(
      (b, [lng, lat]) => b.extend([lng, lat] as [number, number]),
      new mapboxgl.LngLatBounds(
        routeCoords[0] as [number, number],
        routeCoords[0] as [number, number],
      ),
    );
    m.fitBounds(bounds, { padding: 40 });
  }, [routeCoords]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'red' }}>
        <h1>Error: {error}</h1>
      </div>
    );
  }

  return (
    <>
      <div
        ref={mapContainer}
        style={{ width: '100%', height: '100%' }}
      />


      {/* ── Controls panel (top-left) ─────────────────────────────────── */}
      <div
        style={{
          position: 'absolute', top: '16px', left: '16px', zIndex: 10,
          display: 'flex', flexDirection: 'column', gap: '8px',
          fontFamily: "'Inter', sans-serif",
        }}
      >
        {/* Terrain toggle */}
        <ToggleRow
          label="Terrain"
          active={terrainOn}
          activeColor="#10b981"
          labelColor="#34d399"
          onClick={() => setTerrainOn((p) => !p)}
          title={terrainOn ? 'Disable 3D terrain' : 'Enable 3D terrain'}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke={terrainOn ? '#34d399' : '#94a3b8'} strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round">
              <polygon points="3 20 9 4 15 14 19 9 23 20 3 20" />
            </svg>
          }
        />

        {/* Wind toggle */}
        <ToggleRow
          label="Wind"
          active={windOn}
          activeColor="#3b82f6"
          labelColor="#60a5fa"
          onClick={() => setWindOn((p) => !p)}
          title={windOn ? 'Hide wind arrows' : 'Show wind arrows'}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke={windOn ? '#60a5fa' : '#94a3b8'} strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
            </svg>
          }
        />

        {/* Elevation toggle */}
        <ToggleRow
          label="Elevation"
          active={elevationOn}
          activeColor="#0d9488"
          labelColor="#2dd4bf"
          onClick={() => setElevationOn((p) => !p)}
          title={elevationOn ? 'Disable elevation difficulty' : 'Enable elevation difficulty'}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke={elevationOn ? '#2dd4bf' : '#94a3b8'} strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          }
        />

        {/* GPX Upload */}
        <label
          htmlFor="gpx-upload"
          style={{
            background: 'rgba(15, 15, 25, 0.82)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(167,139,250,0.4)',
            borderRadius: '12px',
            padding: '10px 16px',
            display: 'flex', alignItems: 'center', gap: '8px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            cursor: 'pointer',
            color: '#a78bfa', fontSize: '13px', fontWeight: 600,
            letterSpacing: '0.02em',
            fontFamily: "'Inter', sans-serif",
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLLabelElement).style.background = 'rgba(167,139,250,0.12)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLLabelElement).style.background = 'rgba(15, 15, 25, 0.82)'; }}
        >
          <input
            id="gpx-upload"
            type="file"
            accept=".gpx,application/gpx+xml,text/xml"
            style={{ display: 'none' }}
            onChange={handleGpxUpload}
          />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Upload GPX
        </label>

        {/* GPX parse error */}
        {gpxError && (
          <div style={{
            background: 'rgba(239,68,68,0.15)',
            border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: '10px',
            padding: '8px 12px',
            fontSize: '12px',
            color: '#fca5a5',
            fontFamily: "'Inter', sans-serif",
            maxWidth: '200px',
            lineHeight: '1.4',
          }}>
            ⚠ {gpxError}
          </div>
        )}

        {/* Zoom to Route */}
        <button
          id="zoom-to-route"
          onClick={handleZoomToRoute}
          style={{
            background: 'rgba(15, 15, 25, 0.82)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(249,115,22,0.45)',
            borderRadius: '12px',
            padding: '10px 16px',
            display: 'flex', alignItems: 'center', gap: '8px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            cursor: 'pointer',
            color: '#f97316', fontSize: '13px', fontWeight: 600,
            letterSpacing: '0.02em',
            fontFamily: "'Inter', sans-serif",
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(249,115,22,0.15)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(15, 15, 25, 0.82)'; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h18M3 12l4-4M3 12l4 4" />
          </svg>
          Zoom to Route
        </button>
      </div>

      {/* ── Route Debug Panel (mouse-following) ────────────────────────── */}
      <RouteDebugPanel stats={hoveredSegment?.stats ?? null} mousePos={hoveredSegment?.mousePos ?? null} />



      {/* ── Time Slider (bottom-center) ───────────────────────────────── */}
      <TimeSlider
        hourlyData={allData[midIdx] ?? []}
        hourIndex={hourIndex}
        onChange={setHourIndex}
        loading={windLoading}
      />

      {/* ── Legend (bottom-right) ─────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute', bottom: '24px', right: '24px', zIndex: 10,
          background: 'rgba(15, 15, 25, 0.9)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '12px', padding: '16px',
          fontFamily: "'Inter', sans-serif",
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          color: '#e2e8f0', minWidth: '200px',
        }}
      >
        <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 600 }}>Route Difficulty</h4>
        <p style={{ margin: '0 0 10px 0', fontSize: '11px', color: '#64748b', fontWeight: 400 }}>
          {elevationOn ? 'wind + climb penalty' : 'wind only'}
        </p>
        <div style={{
          height: '12px', width: '100%', borderRadius: '6px',
          background: 'linear-gradient(to right, #22c55e, #eab308, #ef4444)',
          marginBottom: '8px',
        }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#94a3b8', fontWeight: 500 }}>
          <span>Easier</span><span>Harder</span>
        </div>

        {/* Forward/Reverse Legend */}
        <div style={{
          marginTop: '8px',
          borderTop: '1px solid rgba(255,255,255,0.1)',
          paddingTop: '6px',
          fontSize: '10px', color: '#94a3b8', textAlign: 'center'
        }}>
          Parallel lines = Fwd / Rev
        </div>
      </div>
    </>
  );
}

// ── Small reusable toggle row ─────────────────────────────────────────────────
interface ToggleRowProps {
  label: string;
  active: boolean;
  activeColor: string;
  labelColor: string;
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
}

function ToggleRow({ label, active, activeColor, labelColor, onClick, title, icon }: ToggleRowProps) {
  return (
    <div
      onClick={onClick}
      title={title}
      style={{
        background: 'rgba(15, 15, 25, 0.82)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '12px',
        padding: '10px 16px',
        display: 'flex', alignItems: 'center', gap: '10px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      {icon}
      <span style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 600, letterSpacing: '0.02em' }}>{label}</span>
      <div style={{
        width: '38px', height: '20px', borderRadius: '10px',
        background: active ? activeColor : '#334155',
        position: 'relative', transition: 'background 0.25s ease', flexShrink: 0,
      }}>
        <div style={{
          position: 'absolute', top: '2px',
          left: active ? '20px' : '2px',
          width: '16px', height: '16px', borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.25s ease',
          boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        }} />
      </div>
      <span style={{ color: active ? labelColor : '#64748b', fontSize: '12px', fontWeight: 500, minWidth: '20px' }}>
        {active ? 'On' : 'Off'}
      </span>
    </div>
  );
}

export default App;
