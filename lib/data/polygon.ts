import type { HistoricalBar, OptionContract, StockSnapshot } from './types';

const BASE = 'https://api.polygon.io';

if (typeof process !== 'undefined' && process.env.POLYGON_PLAN_TIER && process.env.POLYGON_PLAN_TIER !== 'developer' && process.env.POLYGON_PLAN_TIER !== 'advanced') {
  console.warn(
    `[polygon] POLYGON_PLAN_TIER="${process.env.POLYGON_PLAN_TIER}" — V5 features (historical trades, expired contracts) ` +
    `require Developer or higher. Calls to getOptionTrades() will return 403. Set POLYGON_PLAN_TIER=developer in .env.local after upgrading.`,
  );
}

function key(): string {
  const k = process.env.POLYGON_API_KEY;
  if (!k) throw new Error('POLYGON_API_KEY missing');
  return k;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJSON<T>(url: string, attempt: number = 0): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  // Bounded retry on 429: max 3 attempts, max 8s wait per attempt.
  // Total worst-case wait per call: 1 + 2 + 4 = 7s. Earlier 6-attempt
  // exponential could waste 126s per call which compounded to >1hr scans.
  if (res.status === 429 && attempt < 3) {
    const wait = 1000 * Math.pow(2, attempt);
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

// ──────────────────────────────────────────────────────────────────
// V5 Phase 1 — Historical OPRA trades + expired-contract reference.
// Both require Polygon Options Developer ($79) tier or higher.
// ──────────────────────────────────────────────────────────────────

export interface PolygonTrade {
  sip_timestamp: number;
  price: number;
  size: number;
  exchange: number;
  conditions: number[];
  sequence_number?: number;
}

export interface TradesOptions {
  timestamp_gte?: number;
  timestamp_lte?: number;
  order?: 'asc' | 'desc';
  limit?: number;
}

export async function getOptionTrades(
  occTicker: string,
  opts: TradesOptions = {},
): Promise<PolygonTrade[]> {
  const trades: PolygonTrade[] = [];
  const params = new URLSearchParams({ limit: String(opts.limit ?? 50000), order: opts.order ?? 'asc' });
  if (opts.timestamp_gte !== undefined) params.set('timestamp.gte', String(opts.timestamp_gte));
  if (opts.timestamp_lte !== undefined) params.set('timestamp.lte', String(opts.timestamp_lte));

  let url: string | undefined =
    `${BASE}/v3/trades/${encodeURIComponent(occTicker)}?${params.toString()}&apiKey=${key()}`;

  let pages = 0;
  while (url && pages < 100) {
    const resp: { results?: PolygonTrade[]; next_url?: string } =
      await fetchJSON<{ results?: PolygonTrade[]; next_url?: string }>(url);
    if (resp.results) trades.push(...resp.results);
    url = resp.next_url ? `${resp.next_url}&apiKey=${key()}` : undefined;
    pages++;
  }
  return trades;
}

export interface ExpiredContractsParams {
  underlying: string;
  expiration_date_gte?: string;
  expiration_date_lte?: string;
  strike_price_gte?: number;
  strike_price_lte?: number;
  contract_type?: 'call' | 'put';
}

export interface ExpiredContractRef {
  ticker: string;
  underlying_ticker: string;
  contract_type: 'call' | 'put';
  expiration_date: string;
  strike_price: number;
  shares_per_contract: number;
  exercise_style: string;
  primary_exchange: string;
  cfi: string;
}

export async function getContractsIncludingExpired(
  params: ExpiredContractsParams,
): Promise<ExpiredContractRef[]> {
  const contracts: ExpiredContractRef[] = [];
  const qs = new URLSearchParams({
    underlying_ticker: params.underlying,
    expired: 'true',
    limit: '1000',
  });
  if (params.expiration_date_gte) qs.set('expiration_date.gte', params.expiration_date_gte);
  if (params.expiration_date_lte) qs.set('expiration_date.lte', params.expiration_date_lte);
  if (params.strike_price_gte !== undefined) qs.set('strike_price.gte', String(params.strike_price_gte));
  if (params.strike_price_lte !== undefined) qs.set('strike_price.lte', String(params.strike_price_lte));
  if (params.contract_type) qs.set('contract_type', params.contract_type);

  let url: string | undefined = `${BASE}/v3/reference/options/contracts?${qs.toString()}&apiKey=${key()}`;
  let pages = 0;
  while (url && pages < 50) {
    const resp: { results?: ExpiredContractRef[]; next_url?: string } =
      await fetchJSON<{ results?: ExpiredContractRef[]; next_url?: string }>(url);
    if (resp.results) contracts.push(...resp.results);
    url = resp.next_url ? `${resp.next_url}&apiKey=${key()}` : undefined;
    pages++;
  }
  return contracts;
}
