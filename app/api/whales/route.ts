import { runWhaleScan } from '@/lib/engine/whale-scanner';

export const dynamic = 'force-dynamic';
export const maxDuration = 3600;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const universeParam = url.searchParams.get('universe');
  const universe = universeParam
    ? universeParam.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean)
    : undefined;
  const bypassCache = url.searchParams.get('refresh') === '1';

  try {
    const result = await runWhaleScan(universe, { bypassCache });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
