// Fetches the NICC Incident Management Situation Report (daily PDF) and
// extracts the National Preparedness Level plus the Rocky Mountain Area
// section. Written to src/data/sitrep.json and fed to the AI overviews as
// grounded context. Failures keep the previous day's file and exit 0 —
// the sit report is enrichment, never a build blocker.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

// pdf-parse is CommonJS (required via lib path to avoid its debug-mode entry)
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '../src/data/sitrep.json');
const URL_PDF = 'https://www.nifc.gov/nicc-files/sitreprt.pdf';

try {
  const res = await fetch(URL_PDF, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { text } = await pdfParse(Buffer.from(await res.arrayBuffer()));
  if (!text || text.length < 2000) throw new Error(`suspiciously short PDF text (${text?.length})`);

  const nationalPL = /National Preparedness Level\s*:?\s*(\d)/i.exec(text)?.[1] ?? null;
  const reportDate = /([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(text.slice(0, 600))?.[1] ?? null;

  const rmStart = text.search(/Rocky Mountain Area\s*\(PL/i) >= 0
    ? text.search(/Rocky Mountain Area\s*\(PL/i)
    : text.search(/Rocky Mountain Area/i);
  if (rmStart === -1) throw new Error('Rocky Mountain Area section not found');
  const rmaPL = /Rocky Mountain Area\s*\(PL\s*(\d)\)/i.exec(text)?.[1] ?? null;

  // Section runs until the next GACC heading "<Name> Area (PL n)" or a size cap
  const rest = text.slice(rmStart + 20);
  const nextGacc = rest.search(/[A-Z][a-z]+(?: [A-Z][a-z]+)? (?:Area|Basin)\s*\(PL\s*\d\)/);
  const excerpt = ('Rocky Mountain Area' + rest.slice(0, nextGacc > 0 ? Math.min(nextGacc, 2400) : 2400))
    .replace(/\n{2,}/g, '\n').trim();

  writeFileSync(OUT, JSON.stringify({ nationalPL, rmaPL, reportDate, excerpt }, null, 2));
  console.log(`OK sitrep: National PL ${nationalPL}, RMA PL ${rmaPL}, ${reportDate ?? 'date n/a'}, excerpt ${excerpt.length} chars`);
} catch (err) {
  console.error(`WARN sitrep fetch failed: ${err.message}${existsSync(OUT) ? ' — keeping previous file' : ' — no sitrep available'}`);
}
