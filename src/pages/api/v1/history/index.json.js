// Public API v1: list of available daily history snapshots.
const files = import.meta.glob('../../../../data/history/*.json');

export function GET() {
  const dates = Object.keys(files)
    .map((p) => p.split('/').pop().replace('.json', ''))
    .sort();
  return new Response(JSON.stringify({
    schema: 'bwa-history-index/1',
    count: dates.length,
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
    dates,
    dayUrlTemplate: 'https://bewildfireaware.com/api/v1/history/{date}.json',
    timeseries: 'https://bewildfireaware.com/api/v1/timeseries.json',
  }, null, 1), { headers: { 'Content-Type': 'application/json' } });
}
