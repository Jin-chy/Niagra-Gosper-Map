# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

- `npm run check`: type-check everything (`tsc --noEmit`). There are no automated tests or linter, so this is the only automated check.
- `npm run build`: type-check, delete `dist/`, compile the server and `scripts/` with `tsconfig.server.json` to `dist/server/`, and bundle `src/map.ts` with esbuild to `dist/public/assets/`.
- `npm run build:static`: also writes `dist/public/index.html`, `locations.json`, and `qr.png` for Cloudflare Pages. `npm run preview:static` serves it with Wrangler, and `npm run deploy` publishes it to the `niagara-falls-resource-map` Pages project.
- `npm run dev`: build, then serve at `http://localhost:3000`. `npm start` serves an existing build.
- Server environment variables: `HOST`, `PORT`, `PUBLIC_URL` (the QR code target), `DATA_DIR` (location of `locations.json` and the geocode cache), and `NOMINATIM_URL` (geocoder search endpoint).

## Architecture

A small Node `http` server (`app.ts`, no framework) and a vanilla TypeScript and Leaflet client (`src/map.ts`). `src/types.ts` holds the `Category`, `Service`, `Location`, `MappedLocation`, and `MapData` types that both sides share.

**Directory data (`data/locations.json`):** `parseDirectory` in `src/directory.ts` validates and normalizes it, filling defaults and checking category ids and that each service need belongs to one of the service's categories. Services can be plain strings, and they inherit their group's `categories` unless they set their own. Locations with `active: false` are never geocoded or shown. Optional location fields stay `undefined`, and the client renders them as "Call to confirm". Don't fill them with guesses. `geocodeQuery` overrides the address sent to the geocoder.

**Build layout matters for paths.** `app.ts` runs as `dist/server/app.js` and resolves files relative to that location. `../../data/` and `../../public/index.html` point back to the repository root, and `/assets/*` is served from `../public/assets/`, which is `dist/public/assets/`, the esbuild output. `index.html` loads `/assets/map.js` and `/assets/map.css`. The asset route accepts only `[\w-]+.(js|css|png)`, so new asset types or subdirectories require updates to the route regex and `mimeTypes`.

**Static mode (Cloudflare):** `scripts/build-static.ts` geocodes uncached addresses, writes `locations.json`, and copies `index.html` with `data-static-data="/locations.json"` added to `<main>`. When that attribute is present, the client calls `loadStaticData` instead of the API and hides the Re-geocode button. The QR target is `PUBLIC_URL`, defaulting to the pages.dev address.

**Data flow (Node server):**
1. `GET /api/locations` returns the directory with cached coordinates only. It never calls the geocoder.
2. If the response has `needsGeocoding: true`, the client sends `POST /api/geocode`. The **Re-geocode all addresses** button sends `POST /api/regeocode`, which refreshes every entry. Both POST routes require the `X-Map-Request: 1` header as a CSRF guard. The client sets this header in `requestMapData`.
3. `createLocationStore` in `src/locations.ts` handles geocoding. Concurrent requests share one in-flight lookup (`activeLookup`). Requests are spaced at least 1.1 s apart, the server respects `Retry-After`, and after an error it stops the batch and returns a `warning` with saved coordinates.

**Geocode cache (`data/geocoded_locations.csv`, gitignored):** keyed by location `id`. It also stores `full_address`, which is the location's `lookupAddress`, and an entry is reused only while that matches, so editing an address or `geocodeQuery` invalidates the entry. An empty `full_address` from older caches is always reused. Writes go to a temporary file and are then renamed. Each lookup address is `geocodeQuery ?? address` + `", Niagara Falls, NY, USA"`, with a fallback query using `"Niagara Falls, New York"`.

**Client:** `renderResults()` filters active locations, then re-renders the directory cards and the map pins. Selected categories are ORed together. Selecting needs within a category narrows that category to services with those needs. The search text is ANDed with the selected categories and matches names, addresses, category names, service names, and needs. Matching services are highlighted with `isHighlighted`. The pin number is the location `id`, and the pin color comes from the first selected category the location matches, otherwise from its first category. The layout is mobile-first. Below 900px, `.app[data-view]` shows either the map or the list, and `setView` switches between them, calling `invalidateSize` and applying any `pendingBounds` that were deferred while the map was hidden. Render all data values with `textElement`, which uses `textContent`, never `innerHTML`.

`app.py` is the legacy Streamlit version, run with `streamlit run app.py` after installing `requirements.txt`. It reads the older `data/locations.csv`, which no longer matches `locations.json`. Treat the TypeScript app as primary unless asked to work on `app.py`.
