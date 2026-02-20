import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import './App.css';
import { useMultiPointWindData, type HourlyWindEntry } from './hooks/useWindData';
import {
  loadArrowPoint, pooled, buildGridPoints, buildArrowsGeoJSON,
} from './hooks/windArrows';
import type { GridPoint } from './hooks/windArrows';
import { sampleElevations } from './hooks/elevationCache';

import TimeSlider from './components/TimeSlider';
import RouteDebugPanel from './components/RouteDebugPanel';
import type { DebugSegmentStats } from './components/RouteDebugPanel';
import SettingsPanel from './components/SettingsPanel';
import UploadPanel from './components/UploadPanel';


// ─── Map layer IDs ────────────────────────────────────────────────────────────
const DEM_SOURCE_ID = 'mapbox-dem';
const SKY_LAYER_ID = 'sky';
const ROUTE_SOURCE_ID = 'route';
const ROUTE_LAYER_ID = 'route-line';
const ROUTE_OUTLINE_LAYER_ID = 'route-outline';
const WIND_ARROWS_SOURCE = 'wind-arrows';
const WIND_ARROWS_LAYER = 'wind-arrows-layer';
const ARROW_IMAGE_ID = 'wind-arrow-icon';

/** Pick n evenly-spaced points along the route for wind sampling. */
function sampleRoutePoints(coords: number[][], n: number): { lat: number; lon: number }[] {
  if (coords.length === 0) return [];
  return Array.from({ length: n }, (_, i) => {
    const idx = Math.round((i / Math.max(n - 1, 1)) * (coords.length - 1));
    const [lng, lat] = coords[Math.min(idx, coords.length - 1)];
    return { lat, lon: lng };
  });
}

// ─── Arrow grid config ────────────────────────────────────────────────────
const ARROW_COLS = 6;
const ARROW_ROWS = 4;
const ARROW_CONCURRENCY = 3;

// ─── Arrow icon ───────────────────────────────────────────────────────────────
function createArrowImage(size = 40): { width: number; height: number; data: Uint8ClampedArray } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;

  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 4;
  ctx.fillStyle = '#e64a6cff';

  ctx.beginPath();
  ctx.moveTo(cx, 3);
  ctx.lineTo(cx + 9, 18);
  ctx.lineTo(cx + 3, 15);
  ctx.lineTo(cx + 3, size - 3);
  ctx.lineTo(cx - 3, size - 3);
  ctx.lineTo(cx - 3, 15);
  ctx.lineTo(cx - 9, 18);
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const imageData = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data: imageData.data };
}

// ─── Bearing, distance & headwind math ───────────────────────────────────────

function computeBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(lng2 - lng1);
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const y = Math.sin(dLng) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLng);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

function smallestAngle(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function headwindComponent(bearing: number, windFromDeg: number, windSpeedKmh: number): number {
  const theta = smallestAngle(bearing, windFromDeg);
  return windSpeedKmh * Math.cos((theta * Math.PI) / 180);
}

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

// ─── GPX parser ───────────────────────────────────────────────────────────────
function parseGpx(text: string): number[][] {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid XML — file may not be a GPX');

  const trkpts = Array.from(doc.querySelectorAll('trkpt'));
  const rtepts = trkpts.length === 0 ? Array.from(doc.querySelectorAll('rtept')) : [];
  const allPts = trkpts.length > 0 ? trkpts : rtepts;

  if (allPts.length === 0) throw new Error('No track or route points found in GPX');

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

// ─── Segment collection builder ───────────────────────────────────────────────
const CLIMB_K = 600;
const GRADE_CLAMP = 0.5;
const OFFSET_METERS = 5;

function offsetPoint(lat: number, lon: number, bearingDeg: number, distMeters: number): [number, number] {
  const perpRad = ((bearingDeg + 90) * Math.PI) / 180;
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
  includeWind: boolean,
): GeoJSON.FeatureCollection {
  if (coords.length < 2) return { type: 'FeatureCollection', features: [] };

  const hasElev = includeElevation && elevations.length === coords.length;

  // ── Edge-overlap detection (for bidirectional paths) ─────────────────────
  const edgeCounts = new Map<string, number>();
  const getEdgeKey = (p1: number[], p2: number[]) => {
    const k1 = `${p1[1].toFixed(5)},${p1[0].toFixed(5)}`;
    const k2 = `${p2[1].toFixed(5)},${p2[0].toFixed(5)}`;
    return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
  };

  for (let i = 0; i < coords.length - 1; i++) {
    const key = getEdgeKey(coords[i], coords[i + 1]);
    edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
  }

  const edgeVisited = new Map<string, number>();

  // ── Per-segment scoring pass ──────────────────────────────────────────────
  const segmentData: (DebugSegmentStats & {
    coords: number[][];
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
          grade = g;
        }
      }
    }

    const sufferRaw = (includeWind ? headwindRaw : 0) + climbPenalty;

    // Apply offset if this segment is part of a bidirectional path
    const edgeKey = getEdgeKey(coords[i], coords[i + 1]);
    const totalVisits = edgeCounts.get(edgeKey) || 1;
    let finalCoords = [coords[i], coords[i + 1]];

    if (totalVisits > 1) {
      const visitsSoFar = edgeVisited.get(edgeKey) || 0;
      edgeVisited.set(edgeKey, visitsSoFar + 1);
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
      totalScore: 0,
      coords: finalCoords,
    });
  }

  // ── Normalise scores to 0..1 ──────────────────────────────────────────────
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Start/Finish markers
  const startMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const finishMarkerRef = useRef<mapboxgl.Marker | null>(null);

  // Active route coordinates (starts empty; loaded from default GPX, then replaced on upload)
  const [routeCoords, setRouteCoords] = useState<number[][]>([]);
  const [gpxError, setGpxError] = useState<string | null>(null);

  // Date/Time state (YYYY-MM-DD), default to today
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Data state: only update this when "Set Date" is clicked (Manual Fetch)
  const [fetchedDate, setFetchedDate] = useState(selectedDate);

  const handleCommitDate = useCallback(() => {
    setFetchedDate(selectedDate);
  }, [selectedDate]);

  // Current hour of wind data (0-23), default to nearest next hour
  const [hourIndex, setHourIndex] = useState(() => {
    const now = new Date();
    return Math.min(23, now.getHours() + 1);
  });

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
  // Refetches when fetchedDate changes (Manual Fetch)
  const { allData, loading: windLoading } = useMultiPointWindData(samplePoints, fetchedDate);


  // Refs used inside event handlers (avoids stale closures)
  const windOnRef = useRef(windOn);
  const elevationOnRef = useRef(elevationOn);
  const hourIndexRef = useRef(hourIndex);
  const arrowGridRef = useRef<GridPoint[]>([]);
  const refreshArrowsRef = useRef<() => Promise<void>>(async () => { });
  useEffect(() => { windOnRef.current = windOn; }, [windOn]);
  useEffect(() => { elevationOnRef.current = elevationOn; }, [elevationOn]);
  useEffect(() => { hourIndexRef.current = hourIndex; }, [hourIndex]);

  // Compute route stats for the UI
  const distanceKm = useMemo(() => {
    let dist = 0;
    if (routeCoords.length > 1) {
      for (let i = 0; i < routeCoords.length - 1; i++) {
        const [lon1, lat1] = routeCoords[i];
        const [lon2, lat2] = routeCoords[i + 1];
        dist += haversineMeters(lat1, lon1, lat2, lon2);
      }
    }
    return dist / 1000;
  }, [routeCoords]);

  // Elevation gain calculation needs access to elevations.
  // We can add a state for it or compute it when sampleElevations runs.
  const [totalAscent, setTotalAscent] = useState(0);

  // ── Wind arrows: fetch & update source ───────────────────────────────────
  const refreshArrows = useCallback(async () => {
    const m = map.current;
    const src = m?.getSource(WIND_ARROWS_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (!m || !windOnRef.current || !src) return;

    const bounds = m.getBounds();
    if (!bounds) return;

    const pts = buildGridPoints(bounds, ARROW_COLS, ARROW_ROWS);
    arrowGridRef.current = pts;
    const grid = arrowGridRef.current;

    await pooled(
      grid.map((p) => () => loadArrowPoint(p.lat, p.lng, fetchedDate)),
      ARROW_CONCURRENCY
    );

    const geojson = buildArrowsGeoJSON(grid, fetchedDate, hourIndexRef.current);
    src.setData(geojson);

    if (m.getLayer(WIND_ARROWS_LAYER)) {
      m.setLayoutProperty(WIND_ARROWS_LAYER, 'visibility', 'visible');
    }
  }, [windOn, fetchedDate]);

  const [mapStyle, setMapStyle] = useState<'satellite' | 'streets'>('satellite');

  // ── Layer Initialisation (reusable for style switches) ────────────────────
  const initializeLayers = useCallback((m: mapboxgl.Map) => {
    // 1. Arrow Icon
    if (!m.hasImage(ARROW_IMAGE_ID)) {
      m.addImage(ARROW_IMAGE_ID, createArrowImage(40));
    }

    // 2. Route Source
    if (!m.getSource(ROUTE_SOURCE_ID)) {
      m.addSource(ROUTE_SOURCE_ID, {
        type: 'geojson',
        data: buildSegmentCollection(
          routeCoords, samplePoints, [], 0, [], false,
          windOnRef.current
        ),
      });
    }

    // 3. Route Outline Layer (white, appears below main line)
    if (!m.getLayer(ROUTE_OUTLINE_LAYER_ID)) {
      m.addLayer({
        id: ROUTE_OUTLINE_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': 9,
          'line-opacity': 0.9,
        },
      });
    }

    // 4. Route Main Line
    if (!m.getLayer(ROUTE_LAYER_ID)) {
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
    }
  }, [routeCoords, samplePoints]);

  refreshArrowsRef.current = refreshArrows;

  // ── Default GPX route load ────────────────────────────────────────────────
  useEffect(() => {
    fetch('/default_route.gpx')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} loading default_route.gpx`);
        return res.text();
      })
      .then((text) => {
        const coords = parseGpx(text);
        setRouteCoords(coords);
      })
      .catch((err) => {
        console.error('[DefaultRoute] Failed to load default_route.gpx:', err);
        setRouteCoords([]);
      });
  }, []);

  // ── Start/Finish markers ──────────────────────────────────────────────────
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady) return;

    // Remove previous markers
    startMarkerRef.current?.remove();
    finishMarkerRef.current?.remove();
    startMarkerRef.current = null;
    finishMarkerRef.current = null;

    if (routeCoords.length < 2) return;

    const makeMarkerEl = (color: string, label: string) => {
      const el = document.createElement('div');
      el.style.cssText = `
        background: ${color};
        border: 2.5px solid #ffffff;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        width: 22px; height: 22px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.5);
        cursor: default;
      `;
      el.title = label;
      return el;
    };

    const [startLng, startLat] = routeCoords[0];
    const [endLng, endLat] = routeCoords[routeCoords.length - 1];

    startMarkerRef.current = new mapboxgl.Marker({ element: makeMarkerEl('#22c55e', 'Start'), anchor: 'bottom' })
      .setLngLat([startLng, startLat])
      .addTo(m);

    finishMarkerRef.current = new mapboxgl.Marker({ element: makeMarkerEl('#ef4444', 'Finish'), anchor: 'bottom' })
      .setLngLat([endLng, endLat])
      .addTo(m);
  }, [mapReady, routeCoords]);

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
        initializeLayers(m);
        setMapReady(true);

        // ── Route hover: show debug stats panel ───────────────────────────
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

      // ── Pan/zoom: re-fetch wind arrows for new viewport ─────────────────
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

  // ── Style switching ───────────────────────────────────────────────────────
  const handleSetMapStyle = (style: 'satellite' | 'streets') => {
    const m = map.current;
    if (!m) return;
    if (style === mapStyle) return;

    setMapStyle(style);
    const url = style === 'satellite'
      ? 'mapbox://styles/mapbox/satellite-streets-v12'
      : 'mapbox://styles/mapbox/streets-v12';

    m.setStyle(url);
    m.once('style.load', () => {
      initializeLayers(m);
    });
  };

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
  }, [mapReady, terrainOn, enableTerrain, disableTerrain, mapStyle]);

  // ── Elevation sampling (waits for DEM tiles to load) ─────────────────────
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady || routeCoords.length < 2) return;

    if (!m.getSource(DEM_SOURCE_ID)) {
      try {
        m.addSource(DEM_SOURCE_ID, {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14,
        });
      } catch (_) { /* already exists */ }
    }

    if (!m.getTerrain()) {
      m.setTerrain({ source: DEM_SOURCE_ID, exaggeration: 1 });
    }

    const doSample = () => {
      const elevs = sampleElevations(m, routeCoords);
      cachedElevationsRef.current = elevs;
      const src = m.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      if (src) {
        // ── Compute total ascent ──────────────────────────────────────────
        let ascent = 0;
        for (let i = 0; i < elevs.length - 1; i++) {
          const diff = elevs[i + 1] - elevs[i];
          if (diff > 0) ascent += diff;
        }
        setTotalAscent(ascent);

        src.setData(
          buildSegmentCollection(
            routeCoords, samplePoints, allData, hourIndex,
            elevs, elevationOn, windOn,
          ),
        );
      }
    };

    if (m.loaded()) {
      doSample();
    } else {
      m.once('idle', doSample);
    }

    return () => {
      m.off('idle', doSample);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, routeCoords, terrainOn, mapStyle]);

  // ── Recolor route ─────────────────────────────────────────────────────────
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady) return;
    const src = m.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(
      buildSegmentCollection(
        routeCoords, samplePoints, allData, hourIndex,
        cachedElevationsRef.current, elevationOn, windOn,
      ),
    );
  }, [
    mapReady, allData, hourIndex, routeCoords, samplePoints,
    elevationOn, windOn, mapStyle,
  ]);

  // ── Auto-zoom on route change ─────────────────────────────────────────────
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

    void refreshArrows();
  }, [mapReady, windOn, refreshArrows, mapStyle]);

  // ── Wind slider: rebuild from cache ──────────────────────────────────────
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady || !windOn || arrowGridRef.current.length === 0) return;
    const src = m.getSource(WIND_ARROWS_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(buildArrowsGeoJSON(arrowGridRef.current, fetchedDate, hourIndex));
  }, [mapReady, windOn, hourIndex, fetchedDate, mapStyle]);

  // ── GPX upload handler ────────────────────────────────────────────────────
  const handleGpxUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setSelectedFile(file);
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

      {/* ─── Bottom-Left: Settings Panel ─── */}
      <SettingsPanel
        terrainOn={terrainOn}
        setTerrainOn={setTerrainOn}
        windOn={windOn}
        setWindOn={setWindOn}
        elevationOn={elevationOn}
        setElevationOn={setElevationOn}
        mapStyle={mapStyle}
        setMapStyle={handleSetMapStyle}
      />

      {/* ─── Top-Right: Upload Panel ─── */}
      <UploadPanel
        onUpload={handleGpxUpload}
        selectedFile={selectedFile}
        distanceKm={distanceKm}
        elevationGain={totalAscent}
        selectedDate={selectedDate}
        gpxError={gpxError}
        onZoomToRoute={handleZoomToRoute}
      />

      {/* ─── Route Debug Panel (mouse-following) ─── */}
      <RouteDebugPanel stats={hoveredSegment?.stats ?? null} mousePos={hoveredSegment?.mousePos ?? null} />

      {/* ─── Bottom-Center: Time Slider ─── */}
      <TimeSlider
        date={selectedDate}
        setDate={setSelectedDate}
        onCommitDate={handleCommitDate}
        hourlyData={allData[Math.floor(samplePoints.length / 2)] ?? []}
        hourIndex={hourIndex}
        onChange={setHourIndex}
        loading={windLoading}
      />

      {/* ─── Legend (bottom-right) ─── */}
      <div
        style={{
          position: 'absolute', bottom: '24px', right: '24px', zIndex: 10,
          background: 'rgba(15, 15, 25, 0.8)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '12px', padding: '16px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          color: '#e2e8f0', minWidth: '200px',
        }}
      >
        <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 600 }}>Route Difficulty</h4>
        <div style={{
          height: '12px', width: '100%', borderRadius: '6px',
          background: 'linear-gradient(to right, #22c55e, #eab308, #ef4444)',
          marginBottom: '8px',
        }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#94a3b8', fontWeight: 500 }}>
          <span>Easier</span><span>Harder</span>
        </div>
      </div>
    </>
  );
}

export default App;
