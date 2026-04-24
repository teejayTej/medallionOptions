const POLYGON = 'https://api.polygon.io';

function key(): string {
  const k = process.env.POLYGON_API_KEY;
  if (!k) throw new Error('POLYGON_API_KEY missing');
  return k;
}

export type MarketCapTier = 'mega' | 'large' | 'mid' | 'small' | 'unknown';

export interface TickerReference {
  ticker: string;
  name?: string;
  marketCap?: number;
  tier: MarketCapTier;
}

const refCache = new Map<string, { data: TickerReference; expiresAt: number }>();
const REF_TTL_MS = 24 * 60 * 60 * 1000;

export function classifyMarketCap(marketCap?: number): MarketCapTier {
  if (!marketCap || marketCap <= 0) return 'unknown';
  if (marketCap >= 200e9) return 'mega';
  if (marketCap >= 10e9) return 'large';
  if (marketCap >= 2e9) return 'mid';
  return 'small';
}

export function getNotionalFloor(tier: MarketCapTier): number {
  switch (tier) {
    case 'mega': return 250_000;
    case 'large': return 100_000;
    case 'mid': return 40_000;
    case 'small': return 15_000;
    default: return 100_000;
  }
}

export async function getTickerReference(ticker: string): Promise<TickerReference> {
  const cached = refCache.get(ticker);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const url = `${POLYGON}/v3/reference/tickers/${ticker}?apiKey=${key()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const data: TickerReference = { ticker, tier: 'unknown' };
    refCache.set(ticker, { data, expiresAt: Date.now() + 60_000 });
    return data;
  }
  const json = (await res.json()) as {
    results?: { ticker: string; name?: string; market_cap?: number };
  };
  const r = json.results;
  const data: TickerReference = {
    ticker,
    name: r?.name,
    marketCap: r?.market_cap,
    tier: classifyMarketCap(r?.market_cap),
  };
  refCache.set(ticker, { data, expiresAt: Date.now() + REF_TTL_MS });
  return data;
}

export async function getMarketCapTier(ticker: string): Promise<MarketCapTier> {
  return (await getTickerReference(ticker)).tier;
}

export interface EarningsInfo {
  daysToEarnings: number | null;
  earningsDate: string | null;
  hour: string | null;
  available: boolean;
  source: string;
}

const earningsCache = new Map<string, { data: EarningsInfo; expiresAt: number }>();
const EARNINGS_TTL_MS = 6 * 60 * 60 * 1000;

export async function getDaysToEarnings(ticker: string): Promise<EarningsInfo> {
  const cached = earningsCache.get(ticker);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const k = process.env.FINNHUB_API_KEY;
  if (!k) {
    const data: EarningsInfo = {
      daysToEarnings: null,
      earningsDate: null,
      hour: null,
      available: false,
      source: 'FINNHUB_API_KEY not set',
    };
    earningsCache.set(ticker, { data, expiresAt: Date.now() + 60_000 });
    return data;
  }

  const today = new Date();
  const from = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 60 * 86400000).toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${ticker}&token=${k}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Finnhub ${res.status}`);
    const json = (await res.json()) as {
      earningsCalendar?: Array<{ date: string; symbol: string; hour?: string }>;
    };
    const upcoming = (json.earningsCalendar ?? [])
      .filter((e) => e.symbol === ticker && new Date(e.date) >= new Date(today.toISOString().slice(0, 10)))
      .sort((a, b) => a.date.localeCompare(b.date));

    const next = upcoming[0];
    if (!next) {
      const data: EarningsInfo = {
        daysToEarnings: null,
        earningsDate: null,
        hour: null,
        available: true,
        source: 'finnhub (no earnings within 60d)',
      };
      earningsCache.set(ticker, { data, expiresAt: Date.now() + EARNINGS_TTL_MS });
      return data;
    }

    const earningsMs = new Date(next.date + 'T16:00:00Z').getTime();
    const days = Math.ceil((earningsMs - today.getTime()) / 86400000);
    const data: EarningsInfo = {
      daysToEarnings: days,
      earningsDate: next.date,
      hour: next.hour ?? null,
      available: true,
      source: 'finnhub',
    };
    earningsCache.set(ticker, { data, expiresAt: Date.now() + EARNINGS_TTL_MS });
    return data;
  } catch (e) {
    const data: EarningsInfo = {
      daysToEarnings: null,
      earningsDate: null,
      hour: null,
      available: false,
      source: `finnhub error: ${e instanceof Error ? e.message : 'unknown'}`,
    };
    earningsCache.set(ticker, { data, expiresAt: Date.now() + 60_000 });
    return data;
  }
}
