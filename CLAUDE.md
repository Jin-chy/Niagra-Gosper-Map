# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

- `npm run check`: type-check (`tsc --noEmit`). There are no automated tests or linter, so this is the only automated check.
- `npm run build`: type-check, delete `dist/`, bundle the client to `dist/public/assets/`, then bundle and run `scripts/build.ts` (as `dist/build.mjs`) to write `dist/public/index.html`, `locations.json`, and `qr.png`.
- `npm run dev`: build, then serve `dist/public/` with `wrangler pages dev` at `http://localhost:8788`, the same way Cloudflare serves it.
- Publishing: the `niagara-falls-resource-map` Cloudflare Pages project is Git-connected. Each push to `main` runs `npm run build` on Cloudflare (with `NODE_VERSION=22`) and publishes `dist/public`. There is no manual deploy command. Don't run `wrangler deploy`, which is the Workers command and fails for this Pages project.
- `npm run geocode:all`: look up every address again instead of only new or changed ones.
- Build environment variables: `PUBLIC_URL` (QR code target, defaults to the pages.dev address) and `NOMINATIM_URL` (geocoder search endpoint).

## Architecture

A static site with no server. `scripts/build.ts` prepares the data at build time, and `src/map.ts` (vanilla TypeScript and Leaflet) fetches `/locations.json` in the browser. `src/types.ts` holds the shared types.

**Data (`data/locations.json`, the only data file):** `parseDirectory` in `src/directory.ts` validates and normalizes it, filling defaults, checking category ids, and checking that each service need belongs to one of the service's categories. Errors name the exact field. Services can be plain strings, and they inherit their group's `categories` unless they set their own. Optional location fields stay `undefined`, and the client renders them as "Call to confirm". Don't fill them with guesses.

**Geocoding (`src/geocode.ts`):** `loadDirectory` looks up only active locations whose `coordinates` are missing or whose `coordinates.lookupAddress` no longer matches the current address, or every active location with `--refresh`. It saves results back into `locations.json` by re-reading the raw JSON and setting only `coordinates`, then writing a temporary file and renaming it. Coordinates without `lookupAddress` are treated as set by hand and are never replaced. Lookups are spaced 1.1 s apart, and any HTTP error stops the batch with a warning. Each lookup address is `geocodeQuery ?? address` + `", Niagara Falls, NY, USA"`, with a `"Niagara Falls, New York"` fallback. The build prints each pin's matched address so wrong matches are easy to spot.

**Pins:** `id` is the stable key, used by the emergency `data-show-location` buttons and the card element ids. The displayed number is `pin`, assigned at build as 1, 2, 3… across active locations sorted by `id`, so hiding one leaves no gap. Don't hard-code pin numbers in data text.

**Client:** `render()` filters active locations, then re-renders the chips, directory cards, and map pins. Selected categories are ORed together. Selecting needs within a category narrows that category to services with those needs. The search text is ANDed with the selected categories and matches names, addresses, category names, service names, and needs. `isHighlighted` marks matching services. Pin color comes from the first selected category the location matches, otherwise from its first category. The layout is mobile-first. Below 900px, `.app[data-view]` shows either the map or the list, and `setView` calls `invalidateSize` and applies any `pendingBounds` deferred while the map was hidden. Render all data values with `textElement`, which uses `textContent`, never `innerHTML`.
