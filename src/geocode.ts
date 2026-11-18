import { readFile, rename, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { parseDirectory } from './directory.js';
import type { Coordinates, Location } from './types.js';

const SEARCH_URL = process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org/search';
const MIN_REQUEST_INTERVAL = 1100; // Nominatim's usage policy allows at most one request per second.

let nextRequestTime = 0;

async function search(query: string): Promise<Coordinates | undefined> {
  await delay(Math.max(0, nextRequestTime - Date.now()));
  nextRequestTime = Date.now() + MIN_REQUEST_INTERVAL;
  const url = new URL(SEARCH_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');

  const response = await fetch(url, {
    headers: { 'User-Agent': 'NiagaraFallsServicesMap/1.0' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`the geocoder returned HTTP ${response.status}`);
  const [match] = await response.json() as Array<{ lat: string; lon: string; display_name: string }>;
  if (!match) return undefined;
  return { latitude: Number(match.lat), longitude: Number(match.lon), matchedAddress: match.display_name };
}

/** Coordinates are current unless the address changed since they were looked up. */
const hasCurrentCoordinates = (location: Location) =>
  Boolean(location.coordinates) && (!location.coordinates!.lookupAddress || location.coordinates!.lookupAddress === location.lookupAddress);

/**
 * Loads data/locations.json, looks up active locations whose coordinates are missing or out of date
 * (or all of them with `refresh`), and saves new coordinates back into the same file.
 */
export async function loadDirectory(dataFile: string, { refresh = false } = {}) {
  const directory = parseDirectory(await readFile(dataFile, 'utf8'));
  const warnings: string[] = [];
  const found = new Map<number, Coordinates>();

  for (const location of directory.locations) {
    if (!location.active || (!refresh && hasCurrentCoordinates(location))) continue;
    try {
      const match = await search(location.lookupAddress)
        ?? await search(location.lookupAddress.replace(/, NY, USA$/, ', New York'));
      if (match) found.set(location.id, { ...match, lookupAddress: location.lookupAddress });
      else warnings.push(`#${location.id} ${location.name}: address not found. Check the address or add "geocodeQuery".`);
    } catch (error) {
      warnings.push(`Address lookup stopped (${(error as Error).message}). Saved coordinates are used where available.`);
      break;
    }
  }

  if (found.size) {
    // Re-read the raw file so only the coordinates change and every other field is kept as written.
    const raw = JSON.parse(await readFile(dataFile, 'utf8')) as { locations: { id: number; coordinates?: Coordinates }[] };
    for (const location of raw.locations) {
      const coordinates = found.get(location.id);
      if (coordinates) location.coordinates = coordinates;
    }
    const temporaryFile = `${dataFile}.${process.pid}.tmp`;
    await writeFile(temporaryFile, `${JSON.stringify(raw, null, 2)}\n`);
    await rename(temporaryFile, dataFile);
    for (const location of directory.locations) location.coordinates = found.get(location.id) ?? location.coordinates;
  }

  return { directory, warnings };
}
