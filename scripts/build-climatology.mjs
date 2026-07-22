// Builds src/data/fems_climatology.json from the shipped per-FDRA daily SIG
// history CSVs (src/data/fems_history/<slug>_sig_daily.csv, 2005-2024).
//
// Per FDRA:
//   quantiles — 101-point ladder (P0..P100, linear interpolation) of daily
//               station-mean (SIG) ERC over the full period
//   doyMean   — mean SIG ERC per day-of-year (366 slots, leap-aware; the
//               Feb-29 slot simply averages fewer samples)
//
// The CSVs are derived from FEMS station downloads (fuel-filtered, station
// mean) by the fdra_pipeline; this script makes the climatology reproducible
// from the repo alone. Values rounded to 0.1 for compactness. Deterministic:
// same inputs always produce byte-identical output.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(__dirname, '../src/data/fdra_config.json'), 'utf8'));
const HIST_DIR = join(__dirname, '../src/data/fems_history');
const OUT = join(__dirname, '../src/data/fems_climatology.json');

const r1 = (v) => Math.round(v * 10) / 10;

// Day-of-year in a leap calendar (1..366): Feb 29 gets its own slot so every
// calendar date maps to a stable index across years.
const CUM = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]; // leap-year month offsets
export function leapDoy(month, day) {
  return CUM[month - 1] + day;
}

// Linear-interpolated quantile (R type-7) over a sorted array.
function quantile(sorted, p) {
  if (!sorted.length) return null;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

const out = {};
for (const fdra of CONFIG) {
  const csv = readFileSync(join(HIST_DIR, `${fdra.slug}_sig_daily.csv`), 'utf8');
  const values = [];
  const doySum = new Array(366).fill(0), doyN = new Array(366).fill(0);
  let period = [null, null];
  for (const line of csv.split('\n').slice(1)) {
    const [date, ercStr] = line.trim().split(',');
    const erc = parseFloat(ercStr);
    if (!date || !Number.isFinite(erc)) continue;
    values.push(erc);
    period[0] = period[0] ?? date;
    period[1] = date;
    const [, m, d] = date.split('-').map(Number);
    const i = leapDoy(m, d) - 1;
    doySum[i] += erc;
    doyN[i]++;
  }
  if (values.length < 3000) {
    console.error(`FAIL ${fdra.slug}: only ${values.length} climatology days — CSV missing/corrupt`);
    process.exit(1);
  }
  values.sort((a, b) => a - b);
  const quantiles = [];
  for (let p = 0; p <= 100; p++) quantiles.push(r1(quantile(values, p / 100)));
  const doyMean = doySum.map((s, i) => (doyN[i] ? r1(s / doyN[i]) : null));
  out[fdra.slug] = { period, n: values.length, quantiles, doyMean };
  console.log(`OK ${fdra.slug}: ${values.length} days, P50=${quantiles[50]} P90=${quantiles[90]} P100=${quantiles[100]}`);
}

writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote src/data/fems_climatology.json (${Object.keys(out).length} FDRAs)`);
