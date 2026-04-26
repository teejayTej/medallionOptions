import { getVIX } from '@/lib/data/fred';

export const dynamic = 'force-dynamic';

interface CacheEntry { value: number; expiresAt: number }
let cache: CacheEntry | null = null;
const TTL_MS = 5 * 60_000;

export async function GET() {
  if (cache && cache.expiresAt > Date.now()) {
    return Response.json({ value: cache.value, cached: true });
  }
  try {
    const value = await getVIX();
    if (typeof value !== 'number') {
      return Response.json({ value: null, error: 'no value' }, { status: 502 });
    }
    cache = { value, expiresAt: Date.now() + TTL_MS };
    return Response.json({ value, cached: false });
  } catch (e) {
    return Response.json({ value: null, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
