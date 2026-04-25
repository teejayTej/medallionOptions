import { getQuote } from '@/lib/data/finnhub';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker');
  if (!ticker) return Response.json({ error: 'ticker required' }, { status: 400 });
  const q = await getQuote(ticker.toUpperCase());
  if (!q) return Response.json({ error: 'no quote' }, { status: 404 });
  return Response.json(q);
}
