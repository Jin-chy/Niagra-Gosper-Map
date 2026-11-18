# Niagara Falls Community Resource Map

A searchable, filterable map of food, shelter, health, and support services in Niagara Falls, NY. Users can filter by category and by specific need, see which services match, call with one tap, and get directions. No account or location sharing is required.

## Run locally

Install Node.js 22 or newer, then run the following commands from the repository root.

```sh
npm ci
npm run dev
```

Open `http://localhost:3000`. `npm run dev` checks types, builds the application, and starts the server. After building, `npm start` runs the existing build.

## Map data and deployment

All directory content lives in `data/locations.json`. The server checks the file when it loads and reports the exact field if something is wrong.

- **Categories** (`categories`): each has an `id`, `name`, a `short` label for the filter chip, `icon`, `color`, and a list of specific `needs` that users can filter by. A category with no active locations is hidden from the filters, so future categories such as dental care or warming centers can be listed now and appear once a verified provider is added.
- **Locations** (`locations`): keep each `id` stable because it is the pin number. Set `"active": false` and an `inactiveReason` to hide a closed or unverified listing from the map. Optional fields are `hours`, `cost` (`free`, `paid`, `insurance`, or `unknown`, plus an optional `note`), `eligibility`, `access` (walk-in or appointment), `documents`, `lastVerified`, `notes`, `phoneNote`, and `otherPhones`. Anything missing shows as **Call to confirm**, so leave a field out instead of guessing.
- **Services** (`serviceGroups`): each group has a `title`, default `categories`, and `services`. A service can be plain text or an object with `name`, `hours`, `limitedTo` (for example `"Residential participants"`), `categories`, and `needs`. A service's `needs` must come from the needs listed under one of its categories.
- If the geocoder cannot find an address, add `"geocodeQuery"` with a simpler form of the address. The page still shows `address`.

The server reads any existing `data/geocoded_locations.csv` and writes new coordinates to that file. After editing an address, use **Re-geocode all addresses** under **Address matching details** and check the result there.

The app uses OpenStreetMap tiles and defaults to the public Nominatim geocoder. Lookups run on the server, are cached, and are spaced at least 1.1 seconds apart. Follow the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) and use public Nominatim only for small, occasional lookups from a single server. Set `NOMINATIM_URL` to the full search endpoint of a compatible provider if you deploy a different geocoder.

## Cloudflare

The live site is https://niagara-falls-resource-map.pages.dev, a static Cloudflare Pages project with no server.

- `npm run build:static` builds `dist/public/`. It looks up only new or changed addresses (saved in `data/geocoded_locations.csv`), writes the map data to `locations.json`, and creates `qr.png` for the live address.
- `npm run preview:static` serves that build locally at `http://localhost:8788`, the same way Cloudflare does.
- `npm run deploy` builds and publishes it. Run `npx wrangler login` once first.

Locally, the Node server's `PUBLIC_URL` sets where the downloadable QR code points. The defaults for `HOST` and `PORT` are `127.0.0.1` and `3000`. `DATA_DIR` can point to a persistent directory containing `locations.json` and the generated cache.

The original Streamlit implementation is available in `app.py`. It still reads the older `data/locations.csv`, which the TypeScript app no longer uses.
