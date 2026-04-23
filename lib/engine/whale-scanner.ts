import { getPrevClose } from '@/lib/data/polygon';

const POLYGON = 'https://api.polygon.io';

function key(): string {
  const k = process.env.POLYGON_API_KEY;
  if (!k) throw new Error('POLYGON_API_KEY missing');
  return k;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJSON<T>(url: string, attempt: number = 0): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 429 && attempt < 6) {
    await sleep(2000 * Math.pow(2, attempt));
    return fetchJSON<T>(url, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Polygon ${res.status} ${url.split('?')[0]}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export type FlowSignal =
  | 'BULLISH_FLOW'
  | 'BULLISH_MOMENTUM'
  | 'BEARISH_FLOW'
  | 'BEARISH_DRIFT'
  | 'NEUTRAL';

export interface LargeContract {
  symbol: string;
  type: 'call' | 'put';
  strike: number;
  expiration: string;
  volume: number;
  openInterest: number;
  volumeToOI: number;
  estimatedNotional: number;
  delta: number;
  iv: number;
}

export interface WhaleAlert {
  ticker: string;
  price: number;
  priceChange: number;
  optionsVolume: number;
  estimatedAvgVolume: number;
  volumeRatio: number;
  callVolume: number;
  putVolume: number;
  callPutRatio: number;
  netDelta: number;
  totalOI: number;
  callOI: number;
  putOI: number;
  largeContracts: LargeContract[];
  totalLargeNotional: number;
  whaleScore: number;
  flowSignal: FlowSignal;
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface WhaleScanResult {
  scanTime: string;
  tickersScanned: number;
  alertsFound: number;
  alerts: WhaleAlert[];
  errors: Array<{ ticker: string; error: string }>;
  notes: string[];
}

interface SnapshotContract {
  details?: {
    ticker?: string;
    contract_type?: 'call' | 'put';
    strike_price?: number;
    expiration_date?: string;
  };
  greeks?: { delta?: number };
  implied_volatility?: number;
  open_interest?: number;
  day?: { volume?: number; close?: number };
}

function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

async function fetchChain(ticker: string): Promise<SnapshotContract[]> {
  const today = new Date();
  const maxExp = new Date(today.getTime() + 90 * 86400000).toISOString().slice(0, 10);
  const url = `${POLYGON}/v3/snapshot/options/${ticker}?expiration_date.lte=${maxExp}&limit=250&apiKey=${key()}`;
  const all: SnapshotContract[] = [];
  let nextUrl: string | undefined = url;
  let pages = 0;
  while (nextUrl && pages < 3) {
    const data: { results?: SnapshotContract[]; next_url?: string } = await fetchJSON(nextUrl);
    all.push(...(data.results ?? []));
    nextUrl = data.next_url ? `${data.next_url}&apiKey=${key()}` : undefined;
    pages++;
  }
  return all;
}

export async function scanTicker(ticker: string): Promise<WhaleAlert | null> {
  const [snapshot, contracts] = await Promise.all([
    getPrevClose(ticker).catch(() => null),
    fetchChain(ticker).catch(() => [] as SnapshotContract[]),
  ]);

  if (!snapshot || contracts.length < 5) return null;

  const currentPrice = snapshot.price;
  const priceChange = snapshot.changePct / 100;
  const priceUp = priceChange > 0.001;
  const priceDown = priceChange < -0.001;

  let callVol = 0;
  let putVol = 0;
  let callOI = 0;
  let putOI = 0;
  let netDelta = 0;
  const largeContracts: LargeContract[] = [];

  const now = new Date();
  for (const c of contracts) {
    const exp = c.details?.expiration_date;
    if (!exp) continue;
    const dte = daysBetween(now, new Date(exp + 'T16:00:00Z'));
    if (dte > 90 || dte < 0) continue;

    const vol = c.day?.volume ?? 0;
    const oi = c.open_interest ?? 0;
    const type = c.details?.contract_type;
    const delta = c.greeks?.delta ?? 0;
    const dayClose = c.day?.close ?? 0;
    const iv = c.implied_volatility ?? 0;

    if (type === 'call') {
      callVol += vol;
      callOI += oi;
      netDelta += delta * vol;
    } else if (type === 'put') {
      putVol += vol;
      putOI += oi;
    }

    if (oi > 0 && vol > 0 && vol > oi * 0.3) {
      const notional = vol * dayClose * 100;
      if (notional > 20000) {
        largeContracts.push({
          symbol: c.details?.ticker ?? '',
          type: type === 'call' ? 'call' : 'put',
          strike: c.details?.strike_price ?? 0,
          expiration: exp,
          volume: vol,
          openInterest: oi,
          volumeToOI: vol / oi,
          estimatedNotional: notional,
          delta,
          iv,
        });
      }
    }
  }

  const totalVol = callVol + putVol;
  const totalOI = callOI + putOI;
  if (totalVol === 0) return null;

  const estimatedAvg = Math.max(totalOI * 0.04, 500);
  const volumeRatio = totalVol / estimatedAvg;
  const cpRatio = putVol > 0 ? callVol / putVol : callVol > 0 ? 10 : 1;

  largeContracts.sort((a, b) => b.estimatedNotional - a.estimatedNotional);
  const totalLargeNotional = largeContracts.reduce((a, b) => a + b.estimatedNotional, 0);

  let flowSignal: FlowSignal;
  if (priceUp && volumeRatio > 1.5 && cpRatio > 1.3) flowSignal = 'BULLISH_FLOW';
  else if (priceUp && volumeRatio <= 1.5) flowSignal = 'BULLISH_MOMENTUM';
  else if (priceDown && volumeRatio > 1.5 && cpRatio < 0.8) flowSignal = 'BEARISH_FLOW';
  else if (priceDown && volumeRatio <= 1.5) flowSignal = 'BEARISH_DRIFT';
  else flowSignal = 'NEUTRAL';

  let score = 0;
  if (volumeRatio > 5.0) score += 35;
  else if (volumeRatio > 3.0) score += 28;
  else if (volumeRatio > 2.0) score += 20;
  else if (volumeRatio > 1.5) score += 12;

  if (totalLargeNotional > 2_000_000) score += 30;
  else if (totalLargeNotional > 1_000_000) score += 24;
  else if (totalLargeNotional > 500_000) score += 18;
  else if (totalLargeNotional > 100_000) score += 10;
  else if (totalLargeNotional > 20_000) score += 5;

  if (cpRatio > 3.0 || cpRatio < 0.33) score += 20;
  else if (cpRatio > 2.0 || cpRatio < 0.5) score += 14;
  else if (cpRatio > 1.5 || cpRatio < 0.67) score += 8;

  const absDelta = Math.abs(netDelta);
  if (absDelta > 5000) score += 15;
  else if (absDelta > 2000) score += 10;
  else if (absDelta > 500) score += 5;

  score = Math.min(100, score);
  if (score < 15) return null;

  const urgency: WhaleAlert['urgency'] = score >= 55 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW';

  return {
    ticker,
    price: currentPrice,
    priceChange,
    optionsVolume: totalVol,
    estimatedAvgVolume: estimatedAvg,
    volumeRatio,
    callVolume: callVol,
    putVolume: putVol,
    callPutRatio: cpRatio,
    netDelta,
    totalOI,
    callOI,
    putOI,
    largeContracts: largeContracts.slice(0, 10),
    totalLargeNotional,
    whaleScore: score,
    flowSignal,
    urgency,
  };
}

export async function getActiveUniverse(): Promise<{ universe: string[]; notes: string[] }> {
  const core = [
    'NVDA', 'AAPL', 'MSFT', 'GOOGL', 'META', 'AMZN', 'TSLA', 'AMD',
    'AVGO', 'SMCI', 'ARM', 'PLTR',
    'SPY', 'QQQ', 'IWM',
    'COIN', 'MSTR', 'RIVN',
    'JPM', 'GS', 'BAC',
    'NFLX', 'UBER', 'SHOP', 'CRWD',
  ];
  const notes: string[] = [
    'Gainers/losers endpoint (403 on your Polygon plan) — curated 25-ticker high-options-activity list.',
  ];
  return { universe: core, notes };
}

export async function runWhaleScan(universe?: string[]): Promise<WhaleScanResult> {
  const { universe: defaultUni, notes } = await getActiveUniverse();
  const tickers = universe && universe.length > 0 ? universe : defaultUni;

  const alerts: WhaleAlert[] = [];
  const errors: Array<{ ticker: string; error: string }> = [];

  for (const t of tickers) {
    try {
      const alert = await scanTicker(t);
      if (alert) alerts.push(alert);
    } catch (e) {
      errors.push({ ticker: t, error: e instanceof Error ? e.message : String(e) });
    }
  }

  alerts.sort((a, b) => b.whaleScore - a.whaleScore);

  return {
    scanTime: new Date().toISOString(),
    tickersScanned: tickers.length,
    alertsFound: alerts.length,
    alerts,
    errors,
    notes,
  };
}

export function computeCombinedScore(
  medallionScore: number,
  whale: WhaleAlert,
): {
  combined: number;
  tradeDirection: 'SELL_PUTS' | 'SELL_CALLS' | 'IRON_CONDOR' | 'NO_TRADE';
} {
  const isBullish = whale.flowSignal === 'BULLISH_FLOW' || whale.flowSignal === 'BULLISH_MOMENTUM';
  const isBearish = whale.flowSignal === 'BEARISH_FLOW' || whale.flowSignal === 'BEARISH_DRIFT';

  let tradeDirection: 'SELL_PUTS' | 'SELL_CALLS' | 'IRON_CONDOR' | 'NO_TRADE';
  let dirScore: number;

  if (isBullish && whale.flowSignal === 'BULLISH_FLOW') {
    tradeDirection = 'SELL_PUTS';
    dirScore = medallionScore;
  } else if (isBearish && whale.flowSignal === 'BEARISH_FLOW') {
    tradeDirection = 'SELL_CALLS';
    dirScore = medallionScore;
  } else if (whale.whaleScore > 40 && whale.flowSignal === 'NEUTRAL') {
    tradeDirection = 'IRON_CONDOR';
    dirScore = medallionScore * 0.7;
  } else {
    tradeDirection =
      whale.whaleScore > 30 ? (isBullish ? 'SELL_PUTS' : 'SELL_CALLS') : 'NO_TRADE';
    dirScore = medallionScore * 0.5;
  }

  const combined = Math.min(
    100,
    Math.round(whale.whaleScore * 0.45 + dirScore * 0.35 + Math.min(100, whale.volumeRatio * 15) * 0.2),
  );

  return { combined, tradeDirection };
}
