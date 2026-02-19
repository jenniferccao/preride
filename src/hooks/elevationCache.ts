/**
 * elevationCache.ts
 *
 * Wraps map.queryTerrainElevation() with a module-level cache keyed to
 * 5-decimal-place lat/lng strings (~1 m spatial precision).
 *
 * Elevation does NOT change with time, so we sample once per route load
 * and never re-query on time-slider movement.
 *
 * If terrain is disabled (source not loaded → queryTerrainElevation returns null),
 * the fallback elevation is 0 m, so grade = 0 everywhere and the scoring
 * degenerates gracefully to wind-only mode.
 */
import type mapboxgl from 'mapbox-gl';

/** Cache key rounded to 5 decimal places (~1 m precision). */
export function elevationKey(lat: number, lng: number): string {
    return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

// Module-level cache — survives re-renders, reset is the caller's responsibility
// when the route changes (the caller simply discards its cached array reference).
const elevCache = new Map<string, number>();

/**
 * Sample elevations for every coordinate in `coords` using
 * `map.queryTerrainElevation`.  Results are stored in the module cache.
 *
 * @param map    Live mapboxgl.Map instance (must be ready / post-load)
 * @param coords [lng, lat] coordinate array (same order as GeoJSON/Mapbox)
 * @returns      Elevation in metres for each point (0 if terrain unavailable)
 */
export function sampleElevations(
    map: mapboxgl.Map,
    coords: number[][],
): number[] {
    return coords.map(([lng, lat]) => {
        const key = elevationKey(lat, lng);

        if (elevCache.has(key)) return elevCache.get(key)!;

        // queryTerrainElevation returns null when terrain source isn't loaded
        const elev = map.queryTerrainElevation({ lng, lat } as mapboxgl.LngLatLike) ?? 0;
        elevCache.set(key, elev);
        return elev;
    });
}
