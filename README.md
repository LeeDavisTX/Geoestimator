# GeoEstimator

Map-based quantity takeoff for linear utilities (pipeline, power, fiber, water, sewer).
Set up a portfolio, load one centerline per sub-project, draw construction items on the map,
and get live quantities with stations, mileposts and PI angles. Exports feed a separate cost tool.

## Workflow

Tabs run left to right in working order. Drag the divider beside the panel to widen it
(double-click resets it).

1. **Setup**: portfolio name, number, **industry** (one per portfolio; locked once features exist)
   and units (ft, US survey ft or m). Add up to 10 sub-projects (commodity, size, material, scope,
   location, terrain, cost basis year) and add one centerline each: upload a KML, KMZ or GeoJSON line, or **Draw on map**
   (click start to end; Enter finishes). Stationing starts at 0 at the first vertex; **Reverse direction** flips it.
   **Edit route** lets you drag, add (click a midpoint) and delete (right-click) vertices with live
   PI and length updates, then Accept or Revert.
2. **Catalog**: the item list for the portfolio's industry (code, geometry, style, CL flag).
   Download to Excel, edit, and upload again. Items in use on the map are never dropped.
3. **Input**: pick the active sub-project and an item, then click the map (lines: click the last
   point or press Enter; polygons: click the first point). Both stay selected for the next feature.
4. **Table**: features with begin/end stations, offsets and flags; per-row delete, checkbox
   **Delete selected** and **Delete all flagged**. PI table per centerline. Click a row to edit it.
5. **Edit**: selecting a feature in Table or on the map opens it here: item, sub-project, name,
   notes, stations, offset, flag, Edit shape and Delete. **Prev / Next** steps through the
   sub-project in station order.
6. **Takeoff**: live tally per sub-project and item code. Line items show segment count and total
   length (e.g. 3× bores, 640 ft). Portfolio totals when there are 2+ sub-projects. Click a row
   to see those features on the map.

**Context layers** (map, top right): NWI wetlands and NHD streams/waterbodies (WMS), PAD-US
protected lands (USGS tiled service) and HIFLD transmission lines (queried as GeoJSON for the view,
zoom 9+, hover for owner and voltage). Sources are listed in `src/map/context.ts`; add a layer by
adding an entry there.

**Save / Open** a portfolio file (`.geoest.json`); work also persists in the browser. **Export**
an Excel takeoff workbook (Portfolio, Sub-Projects, Quantity Summary, Feature Detail, Coverage,
PI Table), KML (folders per sub-project and item) or GeoJSON.

## How the math works

| Item | Method |
|---|---|
| Line length, leg length, azimuth | Vincenty inverse on WGS84 (Route PI Tool engine, unchanged) |
| PI deflection and bend class | Route PI Tool engine; bend classes shown for Pipeline only, as reference |
| Polygon area | Spherical excess on the WGS84 authalic sphere |
| Station of a feature | Projection onto the sub-project centerline (closest point, leg by leg) |
| Offset and side | Geodesic distance to the closest point; LT/RT relative to stationing direction |

Fittings are never placed automatically: a PI may be broken down in final design, so engineers
place elbows themselves.

## Project layout

```
src/pi-engine/   Route PI Tool engine (geodesic, PI, KML/KMZ, zip). Keep in sync with that repo.
src/core/        Data model, catalogs, linear referencing, calculations, XLSX/KML/GeoJSON I/O
src/map/         Leaflet layer manager with built-in drawing and vertex editing
src/ui/          React UI
tests/           node:test suites (npm test)
```

Leaflet 1.9.4 and the basemaps load from public CDNs at runtime, so the app needs an internet
connection. Nothing is uploaded: files are read and written in the browser.

## Develop

```
npm install
npm run dev               # Vite dev server
npm test                  # engine + core tests
npm run build             # GitHub Pages build (dist/)
npm run build:standalone  # single HTML file: dist-standalone/geoestimator.html and docs/index.html
```

Pushing to `main` runs the tests and deploys to GitHub Pages (`.github/workflows/deploy.yml`).
