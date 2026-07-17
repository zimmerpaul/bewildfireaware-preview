// Public API v1: one day's fire danger snapshot (actuals only, no forecast).
// Dates available are listed at /api/v1/history/index.json.
const files = import.meta.glob('../../../../data/history/*.json', { eager: true });

export function getStaticPaths() {
  return Object.keys(files).map((path) => ({
    params: { date: path.split('/').pop().replace('.json', '') },
  }));
}

export function GET({ params }) {
  const mod = files[`../../../../data/history/${params.date}.json`];
  const body = mod?.default ?? mod;
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}
