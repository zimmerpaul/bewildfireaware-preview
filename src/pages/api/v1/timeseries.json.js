// Public API v1: assembled time series across all archived days — one fetch
// for charting/analysis. Canonical numeric series per FDRA, aligned to the
// shared `dates` array (null = no data that day).
const files = import.meta.glob('../../../data/history/*.json', { eager: true });
import areas from '../../../data/dispatch_areas.json';

// canonical indicator keys (label variants differ between dispatch centers)
const CANON = [
  [/^ERC/i, 'ercPct'],
  [/^BI/i, 'biPct'],
  [/^Winds?$/i, 'windMph'],
  [/Rain/i, 'rain24hrIn'],
  [/^Max Temp/i, 'maxTempF'],
  [/^Min R/i, 'minRhPct'],
  [/^Max R/i, 'maxRhPct'],
  [/^1000/i, 'fuels1000hrPct'],
];

export function GET() {
  const days = Object.keys(files)
    .map((p) => ({ date: p.split('/').pop().replace('.json', ''), snap: files[p].default ?? files[p] }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const dates = days.map((d) => d.date);
  const out = areas.map((a) => {
    const series = { dangerIndex: [], watchoutMet: [] };
    for (const [, key] of CANON) series[key] = [];
    for (const { snap } of days) {
      const area = (snap.areas ?? []).find((x) => x.slug === a.slug);
      series.dangerIndex.push(area?.dangerIndex ?? null);
      series.watchoutMet.push(area?.watchout?.met ?? null);
      for (const [re, key] of CANON) {
        const ind = area?.indicators?.find((i) => re.test(i.label));
        series[key].push(ind?.valueNum ?? null);
      }
    }
    return { slug: a.slug, name: a.name, series };
  });

  return new Response(JSON.stringify({
    schema: 'bwa-timeseries/1',
    generatedAt: new Date().toISOString(),
    dangerScale: { 1: 'Low', 2: 'Moderate', 3: 'High', 4: 'Very High', 5: 'Extreme' },
    dates,
    areas: out,
  }), { headers: { 'Content-Type': 'application/json' } });
}
