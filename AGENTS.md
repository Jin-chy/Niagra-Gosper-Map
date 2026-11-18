# Repository Guidelines

## Project Structure

- `app.ts` serves the TypeScript app, the directory API, and the downloadable QR code. `src/directory.ts` validates `data/locations.json`, and `src/locations.ts` manages the geocoding cache. `src/map.ts`, `src/map.css`, and `public/index.html` define the Leaflet interface.
- `data/locations.json` is the source directory. It holds the categories with their filterable needs and the locations with their services. Use unique integer IDs and keep existing IDs stable because they link directory entries, numbered pins, and cached coordinates. Never invent hours, costs, eligibility, or other details. Leave fields out so the site shows "Call to confirm". Mark closed or unverified listings `"active": false`. `data/locations.csv` is used only by the legacy `app.py`.
- `package.json` and `package-lock.json` define the TypeScript app’s dependencies. `app.py` and `requirements.txt` contain the original Streamlit implementation.

## Local Development

From the repository root, use Node.js 22 or newer.

```sh
npm ci
npm run dev
```

`npm ci` installs locked dependencies. `npm run dev` checks types, builds the app, and serves it at `http://localhost:3000`. `npm run build` builds without starting the server. Uncached addresses require access to the configured geocoder. Keep the generated `data/geocoded_locations.csv` out of commits.

## Coding Style

Use two spaces for TypeScript indentation, `camelCase` for functions and variables, `PascalCase` for types, and `UPPER_CASE` for constants. Use DOM text nodes for values from the data file. The repository has no configured formatter or linter.

## Testing

The repository has no automated test suite or coverage target. Run `npm run check` for type checking, then smoke-test the affected behavior in the browser. Check that pins match directory entries, category, need, and search filters update both views and highlight matching services, and the layout works at phone width, where the Map and List toggle shows one view at a time, as well as on desktop. For address edits, use **Re-geocode all addresses** locally and verify the result under **Address matching details**.

## Commits and Pull Requests

Recent commits use short imperative subjects such as `Update locations.csv`. Keep that style and name the specific change when useful. In pull requests, summarize the change, list the checks you ran, link any related issue, and include a screenshot for visible map or directory changes.
