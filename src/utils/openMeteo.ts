/**
 * Utility to handle Open-Meteo API responses and dispatch wind rate limit events.
 */
export async function handleOpenMeteoResponse(r: Response): Promise<any> {
    if (r.status === 429) {
        window.dispatchEvent(new CustomEvent('wind-rate-limit', { detail: true }));
        throw new Error('Open-Meteo API call limit exceeded (HTTP 429)');
    }

    const text = await r.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch (e) {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return null;
    }

    if (json && json.error && json.reason && typeof json.reason === 'string' && json.reason.toLowerCase().includes('limit')) {
        window.dispatchEvent(new CustomEvent('wind-rate-limit', { detail: true }));
        throw new Error(`Open-Meteo API call limit exceeded: ${json.reason}`);
    }

    if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
    }

    window.dispatchEvent(new CustomEvent('wind-rate-limit', { detail: false }));
    return json;
}

/**
 * Fetch elevation data for an array of coordinates `[lng, lat]` using Open-Meteo `/v1/elevation`.
 * Auto-chunks requests into maximum 100 items per call.
 */
export async function fetchElevations(coords: number[][]): Promise<number[]> {
    const CHUNK_SIZE = 100;
    const allElevations: number[] = [];

    for (let i = 0; i < coords.length; i += CHUNK_SIZE) {
        const chunk = coords.slice(i, i + CHUNK_SIZE);
        const lats = chunk.map(c => c[1].toFixed(5)).join(',');
        const lons = chunk.map(c => c[0].toFixed(5)).join(',');
        const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;

        try {
            const r = await fetch(url);
            const json = await handleOpenMeteoResponse(r);
            if (json && json.elevation) {
                allElevations.push(...json.elevation);
            } else {
                allElevations.push(...new Array(chunk.length).fill(0));
            }
        } catch (e) {
            console.error('[OpenMeteo Elevation] failed to fetch chunk:', e);
            allElevations.push(...new Array(chunk.length).fill(0));
        }
    }
    return allElevations;
}
