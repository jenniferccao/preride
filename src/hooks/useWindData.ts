import { useEffect, useState } from 'react';

export interface HourlyWindEntry {
  time: string;
  speed_kmh: number;
  direction_deg: number;
}

interface WindDataState {
  hourlyData: HourlyWindEntry[] | null;
  loading: boolean;
  error: string | null;
}

// ── Module-level cache (1 fetch per location per page-load session) ───────────
const cache = new Map<string, HourlyWindEntry[]>();
// De-duplicate concurrent fetches for the same key
const inflight = new Map<string, Promise<HourlyWindEntry[]>>();

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

function buildUrl(lat: number, lon: number): string {
  return (
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=windspeed_10m,winddirection_10m` +
    `&forecast_days=2&timezone=auto&wind_speed_unit=kmh`
  );
}

// ── Core fetch (exported for use by useMultiPointWindData) ────────────────────
/** Fetch + cache a single lat/lon. Concurrent calls with the same key share one request. */
export async function fetchWindForPoint(lat: number, lon: number): Promise<HourlyWindEntry[]> {
  const key = cacheKey(lat, lon);
  if (cache.has(key)) return cache.get(key)!;
  if (inflight.has(key)) return inflight.get(key)!;

  const p = fetch(buildUrl(lat, lon))
    .then((r) => {
      if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
      return r.json();
    })
    .then((json) => {
      const times: string[] = json.hourly.time;
      const speeds: number[] = json.hourly.windspeed_10m;
      const dirs: number[] = json.hourly.winddirection_10m;
      const now = Date.now();

      const entries: HourlyWindEntry[] = times
        .map((t, i) => ({
          time: t,
          speed_kmh: Math.round(speeds[i] * 10) / 10,
          direction_deg: Math.round(dirs[i]),
        }))
        .filter((e) => new Date(e.time).getTime() >= now)
        .slice(0, 24);

      cache.set(key, entries);
      inflight.delete(key);
      return entries;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, p);
  return p;
}

// ── Single-point hook (used for WindInfoPanel display) ────────────────────────
export function useWindData(lat: number, lon: number): WindDataState {
  const [state, setState] = useState<WindDataState>(() => {
    const cached = cache.get(cacheKey(lat, lon));
    return cached
      ? { hourlyData: cached, loading: false, error: null }
      : { hourlyData: null, loading: true, error: null };
  });

  useEffect(() => {
    let cancelled = false;
    fetchWindForPoint(lat, lon)
      .then((data) => {
        if (!cancelled) setState({ hourlyData: data, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ hourlyData: null, loading: false, error: String(err) });
      });
    return () => { cancelled = true; };
  }, [lat, lon]);

  return state;
}

// ── Multi-point hook: N points fetched in parallel, cached individually ───────
/**
 * Fetches wind data for N points simultaneously using Promise.all.
 * Each point is independently cached, so the slider never triggers refetches.
 * `points` should be a stable (module-level) constant to avoid re-running the effect.
 */
export function useMultiPointWindData(points: { lat: number; lon: number }[]): {
  allData: (HourlyWindEntry[] | null)[];
  loading: boolean;
  error: string | null;
} {
  const [allData, setAllData] = useState<(HourlyWindEntry[] | null)[]>(
    () => points.map(({ lat, lon }) => cache.get(cacheKey(lat, lon)) ?? null),
  );
  const [loading, setLoading] = useState(
    () => points.some(({ lat, lon }) => !cache.has(cacheKey(lat, lon))),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // When points change (e.g. GPX upload), rebuild allData from cache first
    const fromCache = points.map(({ lat, lon }) => cache.get(cacheKey(lat, lon)) ?? null);
    const anyMissing = fromCache.some((d) => d === null);

    if (!anyMissing) {
      setAllData(fromCache);
      setLoading(false);
      return;
    }

    setAllData(fromCache); // show whatever is cached immediately
    setLoading(true);

    let cancelled = false;
    // Promise.all: all fetches overlap in network time, each caches independently
    Promise.all(points.map(({ lat, lon }) => fetchWindForPoint(lat, lon)))
      .then((results) => {
        if (!cancelled) { setAllData(results); setLoading(false); }
      })
      .catch((err) => {
        if (!cancelled) { setError(String(err)); setLoading(false); }
      });

    return () => { cancelled = true; };
  }, [points]); // eslint-disable-line react-hooks/exhaustive-deps

  return { allData, loading, error };
}
