// Derives per-FDRA geography from the boundary polygons:
//   - which Colorado counties each FDRA touches (for restriction links/context)
//   - a centroid (for geo-targeted external links: NWS point forecast, AirNow)
// Writes src/data/fdra_geo.json. Rerun after update-map if boundaries change.
// County shapes: US Census cartographic boundaries via plotly's public dataset.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const boundaries = JSON.parse(readFileSync(join(__dirname, '../src/data/fdra_boundaries.json'), 'utf8'));

const COUNTIES_URL = 'https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json';
const res = await fetch(COUNTIES_URL);
if (!res.ok) throw new Error(`county fetch failed: HTTP ${res.status}`);
const all = await res.json();
const coCounties = all.features.filter((f) => String(f.id).startsWith('08'));
console.log(`${coCounties.length} Colorado counties loaded`);

function rings(geom) {
  return geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map((p) => p[0]);
}

function inRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

const inGeom = (pt, geom) => rings(geom).some((r) => inRing(pt, r));

const out = {};
for (const f of boundaries.features) {
  const pts = rings(f.geometry).flat();
  // centroid = mean of boundary vertices (plenty accurate for map links)
  const centroid = [
    +(pts.reduce((s, p) => s + p[1], 0) / pts.length).toFixed(4), // lat
    +(pts.reduce((s, p) => s + p[0], 0) / pts.length).toFixed(4), // lon
  ];
  // sample every Nth vertex; county touches FDRA if it contains any sample
  const samples = pts.filter((_, i) => i % 10 === 0);
  const counties = coCounties
    .map((c) => ({ name: c.properties.NAME, hits: samples.filter((p) => inGeom(p, c.geometry)).length }))
    .filter((c) => c.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((c) => c.name);
  out[f.properties.slug] = { counties, centroid };
  console.log(`${f.properties.slug}: [${centroid}] — ${counties.join(', ')}`);
}

writeFileSync(join(__dirname, '../src/data/fdra_geo.json'), JSON.stringify(out, null, 2));
console.log('wrote src/data/fdra_geo.json');
