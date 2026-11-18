# Repository Guidelines

## Project Structure

- `data/locations.json` is the only data file. It holds the categories with their filterable needs, the locations with their services, and each location's map `coordinates`, which the build adds. Keep each `id` unique and stable because it is the key for the location. The pin number shown on the site is assigned automatically. Never invent hours, costs, eligibility, or other details. Leave fields out so the site shows "Call to confirm".
- `src/directory.ts` validates the data file. `src/geocode.ts` looks up missing coordinates. `scripts/build.ts` writes the static site to `dist/public/`. `src/map.ts`, `src/map.css`, and `public/index.html` define the page.
- `wrangler.jsonc` configures the Cloudflare Pages project.

## Local Development

From the repository root, use Node.js 22 or newer.

```sh
npm ci
npm run dev
```

`npm run dev` checks types, builds the site, and serves it at `http://localhost:8788`. New or changed addresses require access to the configured geocoder. Commit `data/locations.json` together with the coordinates the build writes into it.

## Coding Style

Use two spaces for TypeScript indentation, `camelCase` for functions and variables, `PascalCase` for types, and `UPPER_CASE` for constants. Use DOM text nodes for values from the data file. The repository has no configured formatter or linter.

## Testing

The repository has no automated test suite or coverage target. Run `npm run check` for type checking, then smoke-test the affected behavior with `npm run dev`. Check that pins match directory entries, that category, need, and search filters update both views and highlight matching services, and that the layout works at phone width, where the Map and List toggle shows one view at a time, and on desktop. For address edits, check the matched addresses that the build prints.

## Commits and Pull Requests

Recent commits use short imperative subjects such as `Update locations.json`. Keep that style and name the specific change when useful. In pull requests, summarize the change, list the checks you ran, link any related issue, and include a screenshot for visible map or directory changes.
