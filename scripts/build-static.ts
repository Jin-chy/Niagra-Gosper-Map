// Builds a static copy of the site in dist/public/ for Cloudflare.
// Run with `npm run build:static` after `npm run build`.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { createLocationStore } from '../src/locations.js';

// This file runs from dist/server/scripts/, three levels below the repository root.
const root = new URL('../../../', import.meta.url);
const output = new URL('dist/public/', root);
const dataDirectory = process.env.DATA_DIR ?? fileURLToPath(new URL('data/', root));
const DEFAULT_PUBLIC_URL = 'https://niagara-falls-resource-map.pages.dev/';
const publicUrl = new URL(process.env.PUBLIC_URL ?? DEFAULT_PUBLIC_URL);

// Look up only the addresses that are new or changed since the saved cache.
const store = createLocationStore(dataDirectory);
const data = await store.geocode(false);
if (data.warning) console.warn(`Warning: ${data.warning}`);
const unmapped = data.locations.filter((location) => location.active && location.latitude === null);
for (const location of unmapped) {
  console.warn(`Warning: #${location.id} ${location.name} has no map pin. Check its address or add "geocodeQuery".`);
}
// The live site has no geocoder, so do not ask the page to request one.
await writeFile(new URL('locations.json', output), JSON.stringify({ ...data, needsGeocoding: false, warning: undefined }));

await writeFile(new URL('qr.png', output), await QRCode.toBuffer(publicUrl.href, { width: 320 }));

const html = await readFile(new URL('public/index.html', root), 'utf8');
const marker = '<main class="app" id="app"';
if (!html.includes(marker)) throw new Error(`public/index.html must contain ${marker}`);
await writeFile(new URL('index.html', output), html.replace(marker, `${marker} data-static-data="/locations.json"`));

const active = data.locations.filter((location) => location.active).length;
console.log(`Static site written to dist/public/: ${active - unmapped.length} of ${active} active locations mapped, QR code -> ${publicUrl.href}`);
