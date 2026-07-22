// Fetches current-year daily NFDRS observations from FEMS for every FDRA in
// src/data/fdra_config.json, computes the daily SIG (station-mean) ERC, its
// percentile against the FDRA's 2005-2024 climatology, and its danger class
// from the FDRA's breakpoints, and writes src/data/fems_current/<slug>.json.
//
// Robustness mirrors fetch-data.mjs: a failure for one FDRA keeps that FDRA's
// previous JSON (last good data) in place; exit code is non-zero only when NO
// FDRA could be refreshed. No wall-clock timestamps in the output — `updated`
// is the max observation date, so identical data produces identical files and
// the workflow only commits on real changes.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(__dirname, '../src/data/fdra_config.json'), 'utf8'));
const CLIMO = JSON.parse(readFileSync(join(__dirname, '../src/data/fems_climatology.json'), 'utf8'));
const OUT_DIR = join(__dirname, '../src/data/fems_current');
mkdirSync(OUT_DIR, { recursive: true });

// Matches the production AppsScript request: empty endDate = through today.
const YEAR = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' }).slice(0, 4);
const femsUrl = (stationId, fuel) =>
  'https://fems.fs2c.usda.gov/api/climatology/download-nfdr-daily-summary/' +
  `?dataset=all&startDate=${YEAR}-01-01&endDate=&dataFormat=csv&stationIds=${stationId}&fuelModels=${fuel}`;

// Minimal CSV parser handling quoted fields with embedded commas/newlines
// (same approach as fetch-data.mjs).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const r1 = (v) => Math.round(v * 10) / 10;

// Percentile of `erc` against a 101-point quantile ladder (P0..P100), linear
// interpolation between bracketing quantiles; flat runs use the highest P.
function percentileOf(erc, q) {
  if (erc <= q[0]) return 0;
  if (erc >= q[100]) return 100;
  let p = 0;
  for (let i = 100; i >= 1; i--) {
    if (erc >= q[i - 1]) {
      const span = q[i] - q[i - 1];
      p = span > 0 ? i - 1 + (erc - q[i - 1]) / span : i - 1;
      break;
    }
  }
  return r1(p);
}

// Class index 0..4 for breakpoint upper bounds [b1,b2,b3,b4] (inclusive:
// e.g. Craig Zone 1 "0-39 / 40-55 / 56-78 / 79-94 / 95+" => erc<=39 is Low).
function classIdx(erc, bounds) {
  for (let i = 0; i < bounds.length; i++) if (erc <= bounds[i]) return i;
  return bounds.length;
}

// One fetch per unique station+fuel pair (stations are shared across FDRAs,
// sometimes under different fuel models: 50207 is Y for Zone 2, Z for Zone 3).
const stationCache = new Map();
async function stationDaily(stationId, fuel) {
  const key = `${stationId}:${fuel}`;
  if (stationCache.has(key)) return stationCache.get(key);
  const promise = (async () => {
    const res = await fetch(femsUrl(stationId, fuel), { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = parseCsv(await res.text());
    const hdr = rows[0]?.map((c) => c.trim());
    const col = (name) => hdr.indexOf(name);
    const iDate = col('ObservationTime'), iErc = col('ERC'), iFuel = col('FuelModel'), iType = col('NFDRType');
    if (iDate === -1 || iErc === -1) throw new Error(`unexpected CSV header: ${(hdr ?? []).join(',').slice(0, 120)}`);
    const daily = new Map(); // date -> erc (observed rows only)
    for (const row of rows.slice(1)) {
      const date = (row[iDate] ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (iFuel !== -1 && row[iFuel].trim() !== fuel) continue;
      if (iType !== -1 && row[iType].trim() !== 'O') continue; // observed, not forecast
      const erc = parseFloat(row[iErc]);
      if (Number.isFinite(erc)) daily.set(date, erc);
    }
    if (daily.size === 0) throw new Error('no observed ERC rows returned');
    return daily;
  })();
  stationCache.set(key, promise);
  return promise;
}

let ok = 0;
const failed = [];
for (const fdra of CONFIG) {
  const outPath = join(OUT_DIR, `${fdra.slug}.json`);
  const hasPrevious = existsSync(outPath);
  try {
    const climo = CLIMO[fdra.slug];
    if (!climo) throw new Error('no climatology entry');

    const byDate = new Map(); // date -> [erc per reporting station]
    const stationErrors = [];
    for (const st of fdra.stations) {
      try {
        const daily = await stationDaily(st.id, fdra.fuelModel);
        for (const [date, erc] of daily) {
          if (!byDate.has(date)) byDate.set(date, []);
          byDate.get(date).push(erc);
        }
      } catch (err) {
        stationErrors.push(`${st.id}: ${err.message}`);
      }
    }
    // Partial station outages are tolerated (SIG = mean of reporting
    // stations, matching the pipeline); zero stations is a failure.
    if (byDate.size === 0)
      throw new Error(`no station data (${stationErrors.join('; ') || 'empty responses'})`);
    if (stationErrors.length)
      console.error(`WARN ${fdra.slug}: ${stationErrors.length}/${fdra.stations.length} stations failed (${stationErrors.join('; ')})`);

    const bounds = fdra.breakpoints.values;
    const series = [...byDate.keys()].sort().map((date) => {
      const vals = byDate.get(date);
      const erc = r1(vals.reduce((s, v) => s + v, 0) / vals.length);
      return [date, erc, percentileOf(erc, climo.quantiles), classIdx(erc, bounds)];
    });
    const [date, erc, pctile, cls] = series[series.length - 1];
    const out = {
      slug: fdra.slug,
      updated: date, // max observation date — never wall-clock (see header)
      fuelModel: fdra.fuelModel,
      breakpoints: fdra.breakpoints,
      series,
      today: { date, erc, pctile, class: cls, adjective: fdra.breakpoints.adjectives[cls] },
    };
    writeFileSync(outPath, JSON.stringify(out));
    console.log(`OK  ${fdra.slug}: ${date} ERC ${erc} (P${pctile}) — ${out.today.adjective} [${series.length} days]`);
    ok++;
  } catch (err) {
    failed.push(fdra.slug);
    console.error(`FAIL ${fdra.slug}: ${err.message}${hasPrevious ? ' — keeping last good data' : ' — NO cached data!'}`);
  }
}

console.log(`\n${ok}/${CONFIG.length} FDRAs fetched.`);
if (ok === 0) process.exit(1);
