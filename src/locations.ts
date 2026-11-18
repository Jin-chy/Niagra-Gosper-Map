import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { csvFormat, csvParse } from 'd3-dsv';
import { parseDirectory } from './directory.js';
import type { Geocode, Location, MapData } from './types.js';

const NO_COORDINATES: Geocode = { latitude: null, longitude: null, matchedAddress: '' };
const SEARCH_URL = process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org/search';
const MIN_REQUEST_INTERVAL = 1100;

type CachedGeocode = Geocode & { fullAddress: string };

function coordinate(value: string, limit: number): number | null {
  const number = Number(value);
  return value.trim() && Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

export function createLocationStore(dataDirectory: string) {
  const cacheFile = join(dataDirectory, 'geocoded_locations.csv');
  let activeLookup: Promise<MapData> | undefined;
  let nextRequestTime = 0;
  let retryAfter = 0;

  async function readDirectory() {
    return parseDirectory(await readFile(join(dataDirectory, 'locations.json'), 'utf8'));
  }

  async function readCache() {
    try {
      const rows = csvParse(await readFile(cacheFile, 'utf8'));
      return new Map<number, CachedGeocode>(rows.map((row) => [Number(row.id), {
        fullAddress: row.full_address ?? '',
        latitude: coordinate(row.latitude ?? '', 90),
        longitude: coordinate(row.longitude ?? '', 180),
        matchedAddress: row.matched_address ?? '',
      }]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map<number, CachedGeocode>();
      throw error;
    }
  }

  async function saveCache(cache: Map<number, CachedGeocode>) {
    const temporaryFile = join(dataDirectory, `.geocoded_locations.csv.${process.pid}`);
    try {
      await writeFile(temporaryFile, csvFormat(Array.from(cache, ([id, entry]) => ({
        id,
        full_address: entry.fullAddress,
        latitude: entry.latitude,
        longitude: entry.longitude,
        matched_address: entry.matchedAddress,
      }))));
      await rename(temporaryFile, cacheFile);
    } finally {
      await unlink(temporaryFile).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }

  async function search(query: string): Promise<Geocode | undefined> {
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
    if (!response.ok) {
      const retryHeader = response.headers.get('retry-after');
      if (retryHeader) {
        const seconds = Number(retryHeader);
        retryAfter = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retryHeader);
      }
      throw new Error(`Geocoding service returned HTTP ${response.status}`);
    }

    const [match] = await response.json() as Array<{ lat: string; lon: string; display_name: string }>;
    if (!match) return undefined;
    const latitude = coordinate(match.lat, 90);
    const longitude = coordinate(match.lon, 180);
    if (latitude === null || longitude === null) throw new Error('Geocoding service returned invalid coordinates');
    return { latitude, longitude, matchedAddress: match.display_name };
  }

  async function load(refresh: boolean, lookup: boolean): Promise<MapData> {
    const [{ categories, locations }, cache] = await Promise.all([readDirectory(), readCache()]);
    // Inactive listings are never shown on the map, so they are not geocoded.
    const active = locations.filter((location) => location.active);
    const getCached = (location: Location) => {
      const entry = cache.get(location.id);
      return entry && (!entry.fullAddress || entry.fullAddress === location.lookupAddress) ? entry : undefined;
    };

    let warning: string | undefined;
    let cacheChanged = false;
    if (lookup) {
      for (const location of active) {
        if (!refresh && getCached(location)) continue;
        try {
          if (Date.now() < retryAfter) throw new Error('Geocoding retry is delayed');
          const match = await search(location.lookupAddress)
            ?? await search(location.lookupAddress.replace(/, Niagara Falls, NY, USA$/, ', Niagara Falls, New York'))
            ?? { ...NO_COORDINATES, matchedAddress: 'Address not found — check address manually' };
          cache.set(location.id, { ...match, fullAddress: location.lookupAddress });
          cacheChanged = true;
        } catch (error) {
          console.error(error);
          retryAfter = Math.max(retryAfter || 0, Date.now() + 60_000);
          warning = 'Address lookup is temporarily unavailable. The map shows saved coordinates where available.';
          break;
        }
      }
    }
    if (cacheChanged) await saveCache(cache);

    return {
      categories,
      locations: locations.map((location) => {
        const { latitude, longitude, matchedAddress } = (location.active && getCached(location)) || NO_COORDINATES;
        return { ...location, latitude, longitude, matchedAddress };
      }),
      needsGeocoding: active.some((location) => !getCached(location)),
      warning,
    };
  }

  return {
    directory: () => load(false, false),
    geocode(refresh = false) {
      activeLookup ??= load(refresh, true).finally(() => { activeLookup = undefined; });
      return activeLookup;
    },
  };
}
