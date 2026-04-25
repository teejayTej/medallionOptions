export const dynamic = 'force-dynamic';

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}
let cache: CacheEntry | null = null;
const TTL_MS = 30_000;

export async function GET() {
  if (cache && cache.expiresAt > Date.now()) {
    return Response.json(cache.data);
  }
  const k = process.env.POLYGON_API_KEY;
  if (!k) return Response.json({ error: 'POLYGON_API_KEY missing' }, { status: 500 });
  try {
    const res = await fetch(`https://api.polygon.io/v1/marketstatus/now?apiKey=${k}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`polygon ${res.status}`);
    const data = await res.json();
    cache = { data, expiresAt: Date.now() + TTL_MS };
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
