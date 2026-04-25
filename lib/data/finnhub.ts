const BASE = 'https://finnhub.io/api/v1';

function key(): string | undefined {
  return process.env.FINNHUB_API_KEY;
}

async function fetchJSON<T>(path: string): Promise<T | null> {
  const k = key();
  if (!k) return null;
  const sep = path.includes('?') ? '&' : '?';
  const url = `${BASE}${path}${sep}token=${k}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T | null>): Promise<T | null> {
  const c = cache.get(key) as CacheEntry<T> | undefined;
  if (c && c.expiresAt > Date.now()) return c.data;
  const data = await loader();
  if (data !== null) cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

export interface Quote {
  current: number;
  change: number;
  changePct: number;
  high: number;
  low: number;
  open: number;
  prevClose: number;
  timestamp: number;
}

export async function getQuote(ticker: string): Promise<Quote | null> {
  return cached(`q:${ticker}`, 30_000, async () => {
    const json = await fetchJSON<{ c: number; d: number; dp: number; h: number; l: number; o: number; pc: number; t: number }>(
      `/quote?symbol=${ticker}`,
    );
    if (!json || json.c === 0) return null;
    return {
      current: json.c,
      change: json.d,
      changePct: json.dp,
      high: json.h,
      low: json.l,
      open: json.o,
      prevClose: json.pc,
      timestamp: json.t,
    };
  });
}

export interface RecommendationTrend {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

export async function getRecommendations(ticker: string): Promise<RecommendationTrend[]> {
  const data = await cached(`rec:${ticker}`, 6 * 60 * 60 * 1000, async () => {
    const json = await fetchJSON<RecommendationTrend[]>(`/stock/recommendation?symbol=${ticker}`);
    return json ?? [];
  });
  return data ?? [];
}

export interface InsiderTransaction {
  name: string;
  share: number;
  change: number;
  filingDate: string;
  transactionDate: string;
  transactionPrice: number;
  transactionCode: string;
  isDerivative: boolean;
}

export async function getInsiderTransactions(ticker: string, limit: number = 20): Promise<InsiderTransaction[]> {
  const data = await cached(`ins:${ticker}`, 6 * 60 * 60 * 1000, async () => {
    const json = await fetchJSON<{ data: InsiderTransaction[] }>(`/stock/insider-transactions?symbol=${ticker}`);
    return json?.data ?? [];
  });
  return (data ?? []).slice(0, limit);
}

export async function getPeers(ticker: string): Promise<string[]> {
  const data = await cached(`peers:${ticker}`, 24 * 60 * 60 * 1000, async () => {
    const json = await fetchJSON<string[]>(`/stock/peers?symbol=${ticker}`);
    return json ?? [];
  });
  return (data ?? []).filter((t) => t !== ticker);
}

export interface MarketNews {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

export async function getGeneralNews(limit: number = 20): Promise<MarketNews[]> {
  const data = await cached(`mnews`, 5 * 60 * 1000, async () => {
    const json = await fetchJSON<MarketNews[]>(`/news?category=general`);
    return json ?? [];
  });
  return (data ?? []).slice(0, limit);
}

export async function getCompanyNews(ticker: string, days: number = 7, limit: number = 10): Promise<MarketNews[]> {
  const today = new Date();
  const from = new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10);
  const to = today.toISOString().slice(0, 10);
  const data = await cached(`cnews:${ticker}:${days}`, 30 * 60 * 1000, async () => {
    const json = await fetchJSON<MarketNews[]>(`/company-news?symbol=${ticker}&from=${from}&to=${to}`);
    return json ?? [];
  });
  return (data ?? []).slice(0, limit);
}
