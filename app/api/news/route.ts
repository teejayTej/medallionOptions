import { getMarketNews, getTickerNews } from '@/lib/data/news';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker');
  const limit = parseInt(url.searchParams.get('limit') ?? '8', 10);
  try {
    const items = ticker
      ? await getTickerNews(ticker.toUpperCase(), limit)
      : await getMarketNews(limit);
    return Response.json({ items });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
