# Niagara Falls Community Resource Map

A searchable, filterable map of food, shelter, health, and support services in Niagara Falls, NY. Users can filter by category and by specific need, see which services match, call with one tap, and get directions. No account or location sharing is required.

Live site: https://niagara-falls-resource-map.pages.dev, hosted on Cloudflare Pages.

## Run locally

Install Node.js 22 or newer, then run the following commands from the repository root.

```sh
npm ci
npm run dev
```

Open `http://localhost:8788`. The site runs exactly as it does on Cloudflare.

## Publish

The Cloudflare Pages project `niagara-falls-resource-map` is connected to this GitHub repository. Every push to `main` builds the site with `npm run build` and publishes `dist/public` in about a minute, including edits made in GitHub's web editor. No commands or Cloudflare login are needed. Check build progress and logs in the Cloudflare dashboard under **Workers & Pages** → **niagara-falls-resource-map** → **Deployments**, where you can also roll back to an earlier version.

To try a change before it goes live, run `npm run dev` locally first. If an address was added or changed, commit the coordinates the build saves into `data/locations.json` so later builds don't look it up again.

## Editing the map

All information lives in one file, `data/locations.json`. The build checks it and reports the exact field if something is wrong.

- **Categories** (`categories`): each has an `id`, `name`, a `short` label for the filter chip, `icon`, `color`, and a list of specific `needs` that users can filter by. A category with no active locations is hidden, so future categories such as dental care can be listed now and appear once a provider is added.
- **Locations** (`locations`): give each a unique `id` and keep it unchanged. The pin numbers shown on the site are assigned automatically as 1, 2, 3… with no gaps. Set `"active": false` and an `inactiveReason` to hide a listing. Optional fields are `hours`, `cost` (`free`, `paid`, `insurance`, or `unknown`, plus an optional `note`), `eligibility`, `access` (walk-in or appointment), `documents`, `lastVerified`, `notes`, `phoneNote`, and `otherPhones`. Anything missing shows as **Call to confirm**, so leave a field out instead of guessing.
- **Services** (`serviceGroups`): each group has a `title`, default `categories`, and `services`. A service can be plain text or an object with `name`, `hours`, `limitedTo` (for example `"Residential participants"`), `categories`, and `needs`. A service's `needs` must come from the needs listed under one of its categories.
- **Map position** (`coordinates`): the build looks up new or changed addresses and saves the result here. Check the matched address it prints. If an address isn't found, add `"geocodeQuery"` with a simpler form of the address, or set `latitude` and `longitude` yourself and leave out `lookupAddress`. Run `npm run geocode:all` to look up every address again.

Address lookups use the public [Nominatim](https://operations.osmfoundation.org/policies/nominatim/) geocoder, spaced at least 1.1 seconds apart. Set `NOMINATIM_URL` to use a different compatible geocoder. The map uses OpenStreetMap tiles.
