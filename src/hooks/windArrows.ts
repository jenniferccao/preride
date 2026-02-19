/**
 * Wind arrow data: per-grid-point fetching, caching, and GeoJSON generation.
 *
 * Cache strategy: "lat2dec,lng2dec" → 24-entry hourly array.
 * A single fetch covers all 24 hours, so time-slider changes cost 0 network requests.
 */
import type mapboxgl from 'mapbox-gl';

export interface ArrowWindEntry {
    speed_kmh: number;
    direction_deg: number;
}

export interface GridPoint { lat: number; lng: number; }

// ── Module-level cache (survives renders, keyed by 2-decimal lat/lng) ─────────
const arrowCache = new Map<string, (ArrowWindEntry | null)[]>();
const arrowInflight = new Map<string, Promise<void>>();

/** Round to 2 decimal places (~1.1 km grid snapping). */
export function arrowKey(lat: number, lng: number): string {
    return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

/** Return cached entry for (lat, lng, hourIndex), or null if not yet loaded. */
export function getCachedArrow(lat: number, lng: number, hourIndex: number): ArrowWindEntry | null {
    return arrowCache.get(arrowKey(lat, lng))?.[hourIndex] ?? null;
}

// ── Fetch a single grid point (24 h of data) ─────────────────────────────────
export async function loadArrowPoint(lat: number, lng: number): Promise<void> {
    const key = arrowKey(lat, lng);
    if (arrowCache.has(key)) return;
    if (arrowInflight.has(key)) return arrowInflight.get(key);

    const rlat = parseFloat(lat.toFixed(2));
    const rlng = parseFloat(lng.toFixed(2));
    const url =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${rlat}&longitude=${rlng}` +
        `&hourly=windspeed_10m,winddirection_10m` +
        `&forecast_days=2&timezone=auto&wind_speed_unit=kmh`;

    const p = fetch(url)
        .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        })
        .then((json) => {
            const times: string[] = json.hourly.time;
            const speeds: number[] = json.hourly.windspeed_10m;
            const dirs: number[] = json.hourly.winddirection_10m;
            const now = Date.now();

            const entries: (ArrowWindEntry | null)[] = [];
            for (let i = 0; i < times.length && entries.length < 24; i++) {
                if (new Date(times[i]).getTime() >= now) {
                    entries.push({
                        speed_kmh: Math.round(speeds[i] * 10) / 10,
                        direction_deg: Math.round(dirs[i]),
                    });
                }
            }
            while (entries.length < 24) entries.push(null);
            arrowCache.set(key, entries);
        })
        .catch(() => {
            // Mark failed to avoid infinite retries; null entries → hide/fallback
            arrowCache.set(key, new Array(24).fill(null));
        })
        .finally(() => { arrowInflight.delete(key); });

    arrowInflight.set(key, p);
    return p;
}

// ── Concurrency-limited parallel runner ───────────────────────────────────────
/** Run async `fns` with no more than `limit` in flight at once. */
export async function pooled(fns: (() => Promise<void>)[], limit: number): Promise<void> {
    let next = 0;
    const worker = async () => { while (next < fns.length) await fns[next++](); };
    await Promise.all(Array.from({ length: Math.min(limit, fns.length) }, worker));
}

// ── Grid point generation ─────────────────────────────────────────────────────
export function buildGridPoints(
    bounds: mapboxgl.LngLatBounds,
    cols: number,
    rows: number,
): GridPoint[] {
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const pts: GridPoint[] = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            pts.push({
                lat: sw.lat + (ne.lat - sw.lat) * (r / (rows - 1)),
                lng: sw.lng + (ne.lng - sw.lng) * (c / (cols - 1)),
            });
        }
    }
    return pts;
}

// ── GeoJSON builder ───────────────────────────────────────────────────────────
/**
 * Build GeoJSON FeatureCollection for the arrow symbol layer.
 * - Each grid point is a Feature with iconRotate, iconSize, speed, direction.
 * - If a point has no cached data, falls back to the nearest cached point.
 * - If no fallback exists either, the point is omitted (arrow hidden).
 */
export function buildArrowsGeoJSON(
    pts: GridPoint[],
    hourIndex: number,
): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];

    for (const { lat, lng } of pts) {
        let entry = getCachedArrow(lat, lng, hourIndex);

        // Fallback: nearest cached point for this hour
        if (!entry) {
            let bestDist = Infinity;
            for (const [k, dayData] of arrowCache) {
                const e = dayData?.[hourIndex];
                if (!e) continue;
                const [klat, klng] = k.split(',').map(Number);
                const d = (klat - lat) ** 2 + (klng - lng) ** 2;
                if (d < bestDist) { bestDist = d; entry = e; }
            }
        }

        if (!entry) continue; // still no data → omit this arrow

        const iconRotate = (entry.direction_deg + 180) % 360;
        const speedClamped = Math.min(Math.max(entry.speed_kmh, 0), 60);
        const iconSize = 0.35 + (speedClamped / 60) * 0.75;

        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: {
                iconRotate,
                iconSize,
                speed: entry.speed_kmh,
                direction: entry.direction_deg,
            },
        });
    }

    return { type: 'FeatureCollection', features };
}

/**
 * Return the nearest cached wind entry to any lat/lng for the given hour.
 * Used for mouse-hover tooltips; returns null if nothing is cached yet.
 */
export function getNearestArrow(
    lat: number,
    lng: number,
    hourIndex: number,
): ArrowWindEntry | null {
    let best: ArrowWindEntry | null = null;
    let bestDist = Infinity;
    for (const [k, dayData] of arrowCache) {
        const e = dayData?.[hourIndex];
        if (!e) continue;
        const [klat, klng] = k.split(',').map(Number);
        const d = (klat - lat) ** 2 + (klng - lng) ** 2;
        if (d < bestDist) { bestDist = d; best = e; }
    }
    return best;
}
