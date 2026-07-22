// Compares the sheets-derived danger data (src/data/areas/<siteSlug>.json,
// produced by fetch-data.mjs) with the FEMS-derived data
// (src/data/fems_current/<slug>.json, produced by fetch-fems.mjs) for the
// 9 sheets-backed FDRAs, and appends the result to
// src/data/validation/history.json.
//
// history.json shape: { "YYYY-MM-DD": { "<slug>": record, ... }, ... }
// Idempotent: re-runs overwrite the same date+FDRA entries.
//
// Status rules:
//   pass — adjectives equal AND |pctDelta| <= 5
//   warn — |pctDelta| <= 10 OR adjectives one class apart
//   fail — anything worse
//   nodata — either side missing for the comparison date
// The sheets ERC% is FireFamilyPlus-percentile-based while the FEMS side uses
// this repo's 2005-2024 climatology ladder, so small deltas are expected.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(__dirname, '../src/data/fdra_config.json'), 'utf8'));
const OUT_DIR = join(__dirname, '../src/data/validation');
mkdirSync(OUT_DIR, { recursive: true });
const HIST_PATH = join(OUT_DIR, 'history.json');

const ADJ = ['Low', 'Moderate', 'High', 'Very High', 'Extreme'];

// Sheets dates: lastUpdated "7/21/2026 02:38" (preferred), else dateLabel
// "Tuesday, July 21" (year taken from the fems file).
function sheetsDate(area, femsYear) {
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(area.lastUpdated ?? '');
  if (m) return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  const MONTHS = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
  m = /([A-Z][a-z]+)\s+(\d{1,2})/.exec(area.dateLabel ?? '');
  if (m && MONTHS[m[1]] && femsYear)
    return `${femsYear}-${String(MONTHS[m[1]]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  return null;
}

const history = existsSync(HIST_PATH) ? JSON.parse(readFileSync(HIST_PATH, 'utf8')) : {};
const counts = { pass: 0, warn: 0, fail: 0, nodata: 0 };

for (const fdra of CONFIG.filter((f) => f.backend === 'sheets')) {
  const record = { fdra: fdra.slug, siteSlug: fdra.siteSlug, date: null, sheets: null, fems: null, adjectiveMatch: null, pctDelta: null, status: 'nodata' };
  let sheets = null, fems = null;
  try { sheets = JSON.parse(readFileSync(join(__dirname, `../src/data/areas/${fdra.siteSlug}.json`), 'utf8')); } catch {}
  try { fems = JSON.parse(readFileSync(join(__dirname, `../src/data/fems_current/${fdra.slug}.json`), 'utf8')); } catch {}

  const date = sheets ? sheetsDate(sheets, fems?.updated?.slice(0, 4)) : null;
  record.date = date ?? fems?.updated ?? new Date().toISOString().slice(0, 10);

  const ercObs = sheets?.observations?.find((o) => /^ERC\s*%/i.test(o.label));
  const ercPct = ercObs ? parseFloat(String(ercObs.value).replace('%', '')) : NaN;
  const femsDay = date && fems?.series?.find(([d]) => d === date);

  if (sheets?.danger && Number.isFinite(ercPct)) record.sheets = { adjective: sheets.danger, ercPct };
  if (femsDay) {
    const [, erc, pctile, cls] = femsDay;
    record.fems = { adjective: fems.breakpoints.adjectives[cls], erc, pctile };
  }

  if (record.sheets && record.fems) {
    record.adjectiveMatch = record.sheets.adjective === record.fems.adjective;
    record.pctDelta = Math.round((record.fems.pctile - record.sheets.ercPct) * 10) / 10;
    const classGap = Math.abs(ADJ.indexOf(record.sheets.adjective) - ADJ.indexOf(record.fems.adjective));
    const absDelta = Math.abs(record.pctDelta);
    if (record.adjectiveMatch && absDelta <= 5) record.status = 'pass';
    else if (absDelta <= 10 || classGap === 1) record.status = 'warn';
    else record.status = 'fail';
  }

  counts[record.status]++;
  history[record.date] = history[record.date] ?? {};
  history[record.date][fdra.slug] = record;
  console.log(`${record.status.toUpperCase().padEnd(6)} ${fdra.slug} ${record.date}: sheets ${record.sheets ? `${record.sheets.adjective} ERC ${record.sheets.ercPct}%` : '—'} | fems ${record.fems ? `${record.fems.adjective} ERC ${record.fems.erc} (P${record.fems.pctile})` : '—'}${record.pctDelta != null ? ` | Δ${record.pctDelta}` : ''}`);
}

writeFileSync(HIST_PATH, JSON.stringify(history, null, 1));
console.log(`\n${counts.pass} pass, ${counts.warn} warn, ${counts.fail} fail, ${counts.nodata} nodata — ${Object.keys(history).length} day(s) in history`);
