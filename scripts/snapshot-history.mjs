// Writes today's compact per-FDRA snapshot to src/data/history/YYYY-MM-DD.json
// (America/Denver date). Runs in CI after fetch-data; the production repo
// commits these daily, building the /api/v1/history + timeseries archive.
// Idempotent: re-runs on the same day overwrite the same file.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AREAS = JSON.parse(readFileSync(join(__dirname, '../src/data/dispatch_areas.json'), 'utf8'));
const HIST_DIR = join(__dirname, '../src/data/history');
mkdirSync(HIST_DIR, { recursive: true });

const DANGER_INDEX = { 'Low': 1, 'Moderate': 2, 'High': 3, 'Very High': 4, 'Extreme': 5 };
const num = (v) => {
  const n = parseFloat(String(v ?? '').replace('%', ''));
  return Number.isFinite(n) ? n : null;
};

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' }); // YYYY-MM-DD

const snapshot = {
  schema: 'bwa-history-day/1',
  date: today,
  dateLabel: null,
  areas: [],
};

for (const a of AREAS) {
  try {
    const d = JSON.parse(readFileSync(join(__dirname, `../src/data/areas/${a.slug}.json`), 'utf8'));
    snapshot.dateLabel ??= d.dateLabel ?? null;
    snapshot.areas.push({
      slug: a.slug,
      danger: d.danger ?? null,
      dangerIndex: DANGER_INDEX[d.danger] ?? null,
      watchout: d.watchout ? { met: d.watchout.met, total: d.watchout.total } : null,
      indicators: (d.observations ?? []).map((o) => ({
        label: o.label,
        value: o.value,
        valueNum: num(o.value),
        exceedsThreshold: o.triggered ?? null,
      })),
    });
  } catch (err) {
    console.error(`WARN snapshot: no data for ${a.slug}: ${err.message}`);
  }
}

if (snapshot.areas.length === 0) {
  console.error('WARN snapshot: no area data at all — not writing');
  process.exit(0);
}

writeFileSync(join(HIST_DIR, `${today}.json`), JSON.stringify(snapshot));
console.log(`OK history snapshot ${today}: ${snapshot.areas.length} areas (${readdirSync(HIST_DIR).filter((f) => f.endsWith('.json')).length} days archived)`);
