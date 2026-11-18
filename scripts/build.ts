// Builds the site's data, QR code, and page into dist/public/ for Cloudflare Pages.
// `npm run build` runs this after bundling the client. Pass --refresh to look up every address again.
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { loadDirectory } from '../src/geocode.js';
import type { SiteData } from '../src/types.js';

const PUBLIC_URL = process.env.PUBLIC_URL ?? 'https://niagara-falls-resource-map.pages.dev/';
const root = new URL('../', import.meta.url); // This file runs as dist/build.mjs.
const output = new URL('dist/public/', root);
await mkdir(output, { recursive: true });

const { directory, warnings } = await loadDirectory(fileURLToPath(new URL('data/locations.json', root)), {
  refresh: process.argv.includes('--refresh'),
});

// Number active locations 1, 2, 3… by id, so a hidden location leaves no gap.
const active = directory.locations.filter((location) => location.active).sort((a, b) => a.id - b.id);
const pins = new Map(active.map((location, index) => [location.id, index + 1]));

const site: SiteData = {
  categories: directory.categories,
  locations: directory.locations.map(({ lookupAddress, coordinates, ...location }) => ({
    ...location,
    pin: pins.get(location.id),
    coordinates: coordinates && { latitude: coordinates.latitude, longitude: coordinates.longitude },
  })),
};
await writeFile(new URL('locations.json', output), JSON.stringify(site));
await writeFile(new URL('qr.png', output), await QRCode.toBuffer(PUBLIC_URL, { width: 320 }));
await copyFile(new URL('public/index.html', root), new URL('index.html', output));

// Show where each pin landed so wrong matches are easy to spot.
for (const location of active) {
  const where = location.coordinates?.matchedAddress ?? (location.coordinates ? 'set by hand' : 'NO PIN');
  console.log(`${String(pins.get(location.id)).padStart(2)}. ${location.name} (${location.streetAddress}) -> ${where}`);
}
for (const warning of warnings) console.warn(`Warning: ${warning}`);
console.log(`Built dist/public/ with ${active.filter((location) => location.coordinates).length} of ${active.length} active locations on the map. QR code -> ${PUBLIC_URL}`);
