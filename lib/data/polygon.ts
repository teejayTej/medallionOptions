import type { HistoricalBar, OptionContract, StockSnapshot } from './types';

const BASE = 'https://api.polygon.io';

function key(): string {
  const k = process.env.POLYGON_API_KEY;
  if (!k) throw new Error('POLYGON_API_KEY missing');
  return k;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJSON<T>(url: string, attempt: number = 0): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 429 && attempt < 6) {
    const wait = 2000 * Math.pow(2, attempt);
    await sleep(wait);
    return fetchJSON<T>(url, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Polygon ${res.status} ${url.split('?')[0]}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function getPrevClose(ticker: string): Promise<StockSnapshot> {
  const url = `${BASE}/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${key()}`;
  const data = await fetchJSON<{
    results?: Array<{ T: string; c: number; o: number; v: number; t: number }>;
  }>(url);
  const r = data.results?.[0];
  if (!r) throw new Error(`No prev close for ${ticker}`);
  return {
    ticker,
    price: r.c,
    prevClose: r.o,
    changePct: ((r.c - r.o) / r.o) * 100,
    volume: r.v,
    timestamp: r.t,
  };
}

export async function getGroupedDaily(
  maxDaysBack: number = 5,
): Promise<{ date: string; bars: Map<string, HistoricalBar> }> {
  for (let i = 0; i < maxDaysBack; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const url = `${BASE}/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${key()}`;
    try {
      const data = await fetchJSON<{
        results?: Array<{ T: string; t: number; o: number; h: number; l: number; c: number; v: number }>;
      }>(url);
      if (data.results && data.results.length > 0) {
        const bars = new Map<string, HistoricalBar>();
        for (const r of data.results) {
          bars.set(r.T, { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v });
        }
        return { date, bars };
      }
    } catch {
      // try an older date
    }
  }
  return { date: '', bars: new Map() };
}

export async function getHistoricalBars(
  ticker: string,
  days: number = 300,
): Promise<HistoricalBar[]> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const url = `${BASE}/v2/aggs/ticker/${ticker}/range/1/day/${fmt(start)}/${fmt(end)}?adjusted=true&sort=asc&limit=${days + 50}&apiKey=${key()}`;
  const data = await fetchJSON<{
    results?: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>;
  }>(url);
  return data.results ?? [];
}

interface PolygonOptionResult {
  details: {
    contract_type: 'call' | 'put';
    strike_price: number;
    expiration_date: string;
    ticker: string;
  };
  greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number };
  implied_volatility?: number;
  open_interest?: number;
  day?: { close?: number; volume?: number; vwap?: number };
  underlying_asset?: { ticker: string };
}

function dteFromExpiry(expiration: string): number {
  const exp = new Date(expiration + 'T16:00:00Z').getTime();
  const now = Date.now();
  return Math.max(0, Math.round((exp - now) / (24 * 60 * 60 * 1000)));
}

function normalizeOption(r: PolygonOptionResult, underlying: string): OptionContract | null {
  const mid = r.day?.close ?? 0;
  if (mid <= 0) return null;
  const delta = r.greeks?.delta ?? 0;
  if (delta === 0) return null;

  const spreadPct = 0.04;
  const halfSpread = Math.max(0.01, mid * spreadPct);
  const bid = Math.max(0.01, mid - halfSpread);
  const ask = mid + halfSpread;

  return {
    ticker: r.details.ticker,
    underlying,
    type: r.details.contract_type,
    strike: r.details.strike_price,
    expiration: r.details.expiration_date,
    dte: dteFromExpiry(r.details.expiration_date),
    delta,
    gamma: r.greeks?.gamma ?? 0,
    theta: r.greeks?.theta ?? 0,
    vega: r.greeks?.vega ?? 0,
    iv: r.implied_volatility ?? 0,
    impliedVolatility: r.implied_volatility ?? 0,
    openInterest: r.open_interest ?? 0,
    volume: r.day?.volume ?? 0,
    bid,
    ask,
    mid,
    lastPrice: mid,
  };
}

export async function getOptionsChain(
  underlying: string,
  spot: number,
  minDTE: number = 14,
  maxDTE: number = 60,
  strikePct: number = 0.25,
): Promise<OptionContract[]> {
  const today = new Date();
  const minExp = new Date(today.getTime() + minDTE * 86400000).toISOString().slice(0, 10);
  const maxExp = new Date(today.getTime() + maxDTE * 86400000).toISOString().slice(0, 10);
  const minStrike = (spot * (1 - strikePct)).toFixed(2);
  const maxStrike = (spot * (1 + strikePct)).toFixed(2);

  const url =
    `${BASE}/v3/snapshot/options/${underlying}` +
    `?expiration_date.gte=${minExp}&expiration_date.lte=${maxExp}` +
    `&strike_price.gte=${minStrike}&strike_price.lte=${maxStrike}` +
    `&limit=250&apiKey=${key()}`;

  const all: OptionContract[] = [];
  let nextUrl: string | undefined = url;
  let pages = 0;
  while (nextUrl && pages < 4) {
    const data: { results?: PolygonOptionResult[]; next_url?: string } = await fetchJSON(nextUrl);
    for (const r of data.results ?? []) {
      const opt = normalizeOption(r, underlying);
      if (opt) all.push(opt);
    }
    nextUrl = data.next_url ? `${data.next_url}&apiKey=${key()}` : undefined;
    pages++;
  }
  return all;
}
