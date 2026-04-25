export interface NewsItem {
  id: string;
  title: string;
  publisher: string;
  publishedAt: string;
  url: string;
  tickers: string[];
  imageUrl?: string;
  description?: string;
}

interface CacheEntry {
  items: NewsItem[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 10 * 60 * 1000;

interface PolygonNewsResult {
  id: string;
  title: string;
  description?: string;
  article_url: string;
  published_utc: string;
  publisher: { name: string; logo_url?: string };
  tickers?: string[];
  image_url?: string;
}

export async function getTickerNews(ticker: string, limit: number = 5): Promise<NewsItem[]> {
  const key = `t:${ticker}:${limit}`;
  const c = cache.get(key);
  if (c && c.expiresAt > Date.now()) return c.items;

  const k = process.env.POLYGON_API_KEY;
  if (!k) return [];
  try {
    const url = `https://api.polygon.io/v2/reference/news?ticker=${ticker}&order=desc&limit=${limit}&apiKey=${k}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: PolygonNewsResult[] };
    const items: NewsItem[] = (json.results ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      publisher: r.publisher.name,
      publishedAt: r.published_utc,
      url: r.article_url,
      tickers: r.tickers ?? [ticker],
      imageUrl: r.image_url,
      description: r.description,
    }));
    cache.set(key, { items, expiresAt: Date.now() + TTL_MS });
    return items;
  } catch {
    return [];
  }
}

export async function getMarketNews(limit: number = 12): Promise<NewsItem[]> {
  const key = `m:${limit}`;
  const c = cache.get(key);
  if (c && c.expiresAt > Date.now()) return c.items;

  const k = process.env.POLYGON_API_KEY;
  if (!k) return [];
  try {
    const url = `https://api.polygon.io/v2/reference/news?order=desc&limit=${limit}&apiKey=${k}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: PolygonNewsResult[] };
    const items: NewsItem[] = (json.results ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      publisher: r.publisher.name,
      publishedAt: r.published_utc,
      url: r.article_url,
      tickers: r.tickers ?? [],
      imageUrl: r.image_url,
      description: r.description,
    }));
    cache.set(key, { items, expiresAt: Date.now() + TTL_MS });
    return items;
  } catch {
    return [];
  }
}
