import { getGroupedDaily, getPrevClose } from '@/lib/data/polygon';
import type { HistoricalBar } from '@/lib/data/types';

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
  | 'BULLISH_CONVICTION'
  | 'BEARISH_CONVICTION'
  | 'BULLISH_HEDGE'
  | 'BEARISH_HEDGE'
  | 'CONTRARIAN_BULLISH'
  | 'CONTRARIAN_BEARISH'
  | 'MIXED_ACTIVITY'
  | 'LOW_ACTIVITY';

export type NetDeltaDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type VolumeDirection = 'CALL_HEAVY' | 'PUT_HEAVY' | 'BALANCED';

export interface FlowAnalysis {
  signal: FlowSignal;
  netDelta: number;
  netDeltaDirection: NetDeltaDirection;
  volumeDirection: VolumeDirection;
  agreementScore: number;
  isContrarian: boolean;
  confidence: number;
  explanation: string;
}

export interface ContrarianSignal {
  isContrarian: boolean;
  type: 'EXTREME_FEAR' | 'EXTREME_GREED' | 'NONE';
  score: number;
  explanation: string;
}

export type SmartMoneySignal = 'ACCUMULATING' | 'HEDGING' | 'DISTRIBUTING' | 'NEUTRAL';

export interface DeltaProfile {
  atmCallVolume: number;
  otmCallVolume: number;
  atmPutVolume: number;
  otmPutVolume: number;
  convictionRatio: number;
  smartMoneySignal: SmartMoneySignal;
}

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

export type TradeDirection = 'SELL_PUTS' | 'SELL_CALLS' | 'IRON_CONDOR' | 'NO_TRADE';

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
  flowAnalysis: FlowAnalysis;
  contrarian: ContrarianSignal;
  deltaProfile: DeltaProfile;
  tradeDirection: TradeDirection;
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface WhaleScanResult {
  scanTime: string;
  tickersScanned: number;
  alertsFound: number;
  alerts: WhaleAlert[];
  errors: Array<{ ticker: string; error: string }>;
  notes: string[];
  cacheHit: boolean;
  cacheAgeSec: number;
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

export function classifyFlow(
  callVolume: number,
  putVolume: number,
  netDelta: number,
  volumeRatio: number,
  priceChange: number,
): FlowAnalysis {
  const totalVol = callVolume + putVolume;
  if (totalVol === 0 || volumeRatio < 1.2) {
    return {
      signal: 'LOW_ACTIVITY',
      netDelta,
      netDeltaDirection: 'NEUTRAL',
      volumeDirection: 'BALANCED',
      agreementScore: 0,
      isContrarian: false,
      confidence: 0,
      explanation: 'No significant options activity.',
    };
  }

  const cpRatio = putVolume > 0 ? callVolume / putVolume : 10;
  const volumeDirection: VolumeDirection =
    cpRatio > 1.3 ? 'CALL_HEAVY' : cpRatio < 0.77 ? 'PUT_HEAVY' : 'BALANCED';

  const deltaThreshold = Math.max(2000, totalVol * 0.01);
  const netDeltaDirection: NetDeltaDirection =
    netDelta > deltaThreshold ? 'BULLISH' : netDelta < -deltaThreshold ? 'BEARISH' : 'NEUTRAL';

  const isContrarian =
    (volumeDirection === 'PUT_HEAVY' && netDeltaDirection === 'BULLISH') ||
    (volumeDirection === 'CALL_HEAVY' && netDeltaDirection === 'BEARISH');

  let agreementScore = 50;
  if (volumeDirection === 'CALL_HEAVY' && netDeltaDirection === 'BULLISH') agreementScore = 90;
  else if (volumeDirection === 'PUT_HEAVY' && netDeltaDirection === 'BEARISH') agreementScore = 90;
  else if (isContrarian) agreementScore = 20;

  void priceChange;

  let signal: FlowSignal;
  let explanation: string;
  let confidence: number;

  if (isContrarian && volumeDirection === 'PUT_HEAVY' && netDeltaDirection === 'BULLISH') {
    if (volumeRatio > 3.0 && Math.abs(netDelta) > deltaThreshold * 3) {
      signal = 'CONTRARIAN_BULLISH';
      confidence = 0.85;
      explanation =
        `Extreme put volume (C/P ${cpRatio.toFixed(2)}) but net Δ is +${netDelta.toFixed(0)}. ` +
        `Puts are likely hedges on existing long positions — directional conviction is bullish ` +
        `despite surface-level bearish appearance. Consistent with pre-catalyst protection.`;
    } else {
      signal = 'BULLISH_HEDGE';
      confidence = 0.65;
      explanation = `Put volume > call volume but net Δ is positive. Likely hedging of long exposure.`;
    }
  } else if (isContrarian && volumeDirection === 'CALL_HEAVY' && netDeltaDirection === 'BEARISH') {
    if (volumeRatio > 3.0 && Math.abs(netDelta) > deltaThreshold * 3) {
      signal = 'CONTRARIAN_BEARISH';
      confidence = 0.8;
      explanation =
        `Heavy call volume (C/P ${cpRatio.toFixed(2)}) but net Δ is ${netDelta.toFixed(0)}. ` +
        `Calls may be sold (income) or hedges on short positions. Potential top signal.`;
    } else {
      signal = 'BEARISH_HEDGE';
      confidence = 0.6;
      explanation = `Call volume > put volume but net Δ is negative. Mixed institutional signals.`;
    }
  } else if (netDeltaDirection === 'BULLISH' && volumeRatio > 1.5) {
    signal = 'BULLISH_CONVICTION';
    confidence = 0.75;
    explanation =
      `Strong positive net Δ (+${netDelta.toFixed(0)}) with ${volumeRatio.toFixed(1)}× volume. ` +
      `Volume and delta agree on bullish direction.`;
  } else if (netDeltaDirection === 'BEARISH' && volumeRatio > 1.5) {
    signal = 'BEARISH_CONVICTION';
    confidence = 0.75;
    explanation =
      `Strong negative net Δ (${netDelta.toFixed(0)}) with ${volumeRatio.toFixed(1)}× volume. ` +
      `Volume and delta agree on bearish direction.`;
  } else if (volumeRatio > 2.0 && netDeltaDirection === 'NEUTRAL') {
    signal = 'MIXED_ACTIVITY';
    confidence = 0.5;
    explanation = `High volume (${volumeRatio.toFixed(1)}×) but net Δ near zero. Both sides active.`;
  } else {
    signal = 'LOW_ACTIVITY';
    confidence = 0.3;
    explanation = 'No clear institutional signal.';
  }

  return {
    signal,
    netDelta,
    netDeltaDirection,
    volumeDirection,
    agreementScore,
    isContrarian,
    confidence,
    explanation,
  };
}

export function detectContrarianSetup(
  callPutRatio: number,
  volumeRatio: number,
  netDelta: number,
  priceChange: number,
  ivRank: number,
): ContrarianSignal {
  const fearScore =
    (callPutRatio < 0.3 ? 30 : callPutRatio < 0.5 ? 20 : callPutRatio < 0.7 ? 10 : 0) +
    (volumeRatio > 5 ? 25 : volumeRatio > 3 ? 18 : volumeRatio > 2 ? 10 : 0) +
    (priceChange < -0.03 ? 15 : priceChange < -0.01 ? 8 : 0) +
    (ivRank > 80 ? 15 : ivRank > 60 ? 8 : 0) +
    (netDelta > 5000 ? 15 : netDelta > 0 ? 8 : 0);

  const greedScore =
    (callPutRatio > 3.0 ? 30 : callPutRatio > 2.0 ? 20 : callPutRatio > 1.5 ? 10 : 0) +
    (volumeRatio > 5 ? 25 : volumeRatio > 3 ? 18 : volumeRatio > 2 ? 10 : 0) +
    (priceChange > 0.03 ? 15 : priceChange > 0.01 ? 8 : 0) +
    (ivRank > 80 ? 15 : ivRank > 60 ? 8 : 0) +
    (netDelta < -5000 ? 15 : netDelta < 0 ? 8 : 0);

  if (fearScore >= 50) {
    return {
      isContrarian: true,
      type: 'EXTREME_FEAR',
      score: Math.min(100, fearScore),
      explanation:
        `Extreme put buying (C/P ${callPutRatio.toFixed(2)}) with ${volumeRatio.toFixed(1)}× volume. ` +
        `Net Δ ${netDelta > 0 ? 'confirms smart money is actually bullish' : 'aligns with bearish sentiment'}.`,
    };
  }
  if (greedScore >= 50) {
    return {
      isContrarian: true,
      type: 'EXTREME_GREED',
      score: Math.min(100, greedScore),
      explanation:
        `Extreme call buying (C/P ${callPutRatio.toFixed(2)}) with ${volumeRatio.toFixed(1)}× volume. ` +
        `Net Δ ${netDelta < 0 ? 'confirms smart money is actually hedging' : 'aligns with bullish sentiment'}.`,
    };
  }
  return { isContrarian: false, type: 'NONE', score: 0, explanation: 'No contrarian setup detected.' };
}

export function classifyDeltaProfile(
  atmCallVol: number,
  otmCallVol: number,
  atmPutVol: number,
  otmPutVol: number,
): DeltaProfile {
  const totalATM = atmCallVol + atmPutVol;
  const totalOTM = otmCallVol + otmPutVol;
  const convictionRatio = totalOTM > 0 ? totalATM / totalOTM : totalATM > 0 ? 10 : 1;

  let smartMoneySignal: SmartMoneySignal;
  if (atmCallVol > atmPutVol * 2 && convictionRatio > 1.5) {
    smartMoneySignal = 'ACCUMULATING';
  } else if (otmPutVol > atmCallVol * 2 && convictionRatio < 0.7) {
    smartMoneySignal = 'HEDGING';
  } else if (atmPutVol > atmCallVol * 2) {
    smartMoneySignal = 'DISTRIBUTING';
  } else {
    smartMoneySignal = 'NEUTRAL';
  }

  return {
    atmCallVolume: atmCallVol,
    otmCallVolume: otmCallVol,
    atmPutVolume: atmPutVol,
    otmPutVolume: otmPutVol,
    convictionRatio,
    smartMoneySignal,
  };
}

export function computeWhaleScoreV2(
  volumeRatio: number,
  totalLargeNotional: number,
  flow: FlowAnalysis,
  contrarian: ContrarianSignal,
  deltaProfile: DeltaProfile,
): number {
  let score = 0;
  if (volumeRatio > 5.0) score += 25;
  else if (volumeRatio > 3.0) score += 20;
  else if (volumeRatio > 2.0) score += 15;
  else if (volumeRatio > 1.5) score += 8;

  if (totalLargeNotional > 2_000_000) score += 20;
  else if (totalLargeNotional > 500_000) score += 14;
  else if (totalLargeNotional > 100_000) score += 8;

  if (flow.signal === 'BULLISH_CONVICTION' || flow.signal === 'BEARISH_CONVICTION') score += 20;
  else if (flow.signal === 'CONTRARIAN_BULLISH' || flow.signal === 'CONTRARIAN_BEARISH') score += 18;
  else if (flow.signal === 'BULLISH_HEDGE' || flow.signal === 'BEARISH_HEDGE') score += 10;

  if (contrarian.isContrarian) {
    score += Math.round(contrarian.score * 0.15);
  }

  if (deltaProfile.smartMoneySignal === 'ACCUMULATING') score += 20;
  else if (deltaProfile.smartMoneySignal === 'HEDGING') score += 15;
  else if (deltaProfile.smartMoneySignal === 'DISTRIBUTING') score += 12;

  return Math.min(100, score);
}

export function whaleTradeDirection(
  flow: FlowAnalysis,
  deltaProfile: DeltaProfile,
): TradeDirection {
  if (
    flow.signal === 'CONTRARIAN_BULLISH' ||
    (deltaProfile.smartMoneySignal === 'HEDGING' && flow.netDeltaDirection === 'BULLISH')
  ) {
    return 'SELL_PUTS';
  }
  if (
    flow.signal === 'CONTRARIAN_BEARISH' ||
    (deltaProfile.smartMoneySignal === 'DISTRIBUTING' && flow.netDeltaDirection === 'BEARISH')
  ) {
    return 'SELL_CALLS';
  }
  if (flow.signal === 'BULLISH_CONVICTION' || flow.signal === 'BULLISH_HEDGE') return 'SELL_PUTS';
  if (flow.signal === 'BEARISH_CONVICTION' || flow.signal === 'BEARISH_HEDGE') return 'SELL_CALLS';
  if (flow.signal === 'MIXED_ACTIVITY') return 'IRON_CONDOR';
  return 'NO_TRADE';
}

export async function scanTicker(
  ticker: string,
  preFetchedBar?: HistoricalBar,
): Promise<WhaleAlert | null> {
  const snapshotPromise = preFetchedBar
    ? Promise.resolve({
        ticker,
        price: preFetchedBar.c,
        prevClose: preFetchedBar.o,
        changePct: ((preFetchedBar.c - preFetchedBar.o) / preFetchedBar.o) * 100,
        volume: preFetchedBar.v,
        timestamp: preFetchedBar.t,
      })
    : getPrevClose(ticker).catch(() => null);

  const [snapshot, contracts] = await Promise.all([
    snapshotPromise,
    fetchChain(ticker).catch(() => [] as SnapshotContract[]),
  ]);

  if (!snapshot || contracts.length < 5) return null;

  const currentPrice = snapshot.price;
  const priceChange = snapshot.changePct / 100;

  let callVol = 0;
  let putVol = 0;
  let callOI = 0;
  let putOI = 0;
  let netDelta = 0;
  let atmCallVol = 0;
  let otmCallVol = 0;
  let atmPutVol = 0;
  let otmPutVol = 0;
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
    const isATM = Math.abs(delta) > 0.35;

    if (type === 'call') {
      callVol += vol;
      callOI += oi;
      netDelta += delta * vol;
      if (isATM) atmCallVol += vol;
      else otmCallVol += vol;
    } else if (type === 'put') {
      putVol += vol;
      putOI += oi;
      if (isATM) atmPutVol += vol;
      else otmPutVol += vol;
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

  const flowAnalysis = classifyFlow(callVol, putVol, netDelta, volumeRatio, priceChange);
  const contrarian = detectContrarianSetup(cpRatio, volumeRatio, netDelta, priceChange, 0);
  const deltaProfile = classifyDeltaProfile(atmCallVol, otmCallVol, atmPutVol, otmPutVol);
  const tradeDirection = whaleTradeDirection(flowAnalysis, deltaProfile);
  const score = computeWhaleScoreV2(volumeRatio, totalLargeNotional, flowAnalysis, contrarian, deltaProfile);

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
    flowSignal: flowAnalysis.signal,
    flowAnalysis,
    contrarian,
    deltaProfile,
    tradeDirection,
    urgency,
  };
}

export async function getActiveUniverse(): Promise<{ universe: string[]; notes: string[] }> {
  const core = [
    'NVDA', 'AAPL', 'MSFT', 'GOOGL', 'META', 'AMZN', 'TSLA', 'AMD',
    'AVGO', 'SMCI', 'ARM', 'PLTR', 'INTC',
    'SPY', 'QQQ', 'IWM',
    'COIN', 'MSTR', 'RIVN',
    'JPM', 'GS', 'BAC',
    'NFLX', 'UBER', 'SHOP', 'CRWD',
  ];
  const notes: string[] = [
    'Gainers/losers endpoint (403 on your Polygon plan) — curated 26-ticker high-options-activity list.',
    'Contrarian IV-rank input is 0 here (not computed in whale scanner); Medallion analyze uses real IVR.',
  ];
  return { universe: core, notes };
}

interface CacheEntry {
  result: WhaleScanResult;
  expiresAt: number;
  storedAt: number;
}

const CACHE_VERSION = 'v2';
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function cacheKey(tickers: string[]): string {
  return `${CACHE_VERSION}:${[...tickers].sort().join(',')}`;
}

export async function runWhaleScan(
  universe?: string[],
  opts: { bypassCache?: boolean } = {},
): Promise<WhaleScanResult> {
  const { universe: defaultUni, notes: baseNotes } = await getActiveUniverse();
  const tickers = universe && universe.length > 0 ? universe : defaultUni;
  const key = cacheKey(tickers);

  if (!opts.bypassCache) {
    const entry = cache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      const ageSec = Math.round((Date.now() - entry.storedAt) / 1000);
      return {
        ...entry.result,
        cacheHit: true,
        cacheAgeSec: ageSec,
        notes: [
          `Cache hit — scan from ${new Date(entry.result.scanTime).toLocaleTimeString()} (${ageSec}s ago). Refresh to re-scan.`,
          ...entry.result.notes,
        ],
      };
    }
  }

  const notes = [...baseNotes];
  let groupedBars: Map<string, HistoricalBar> = new Map();
  try {
    const grouped = await getGroupedDaily();
    groupedBars = grouped.bars;
    if (groupedBars.size > 0) {
      notes.push(
        `Bulk stock prices: 1 grouped-aggregates call covered ${groupedBars.size} tickers for ${grouped.date}.`,
      );
    } else {
      notes.push('Grouped daily returned empty — falling back to per-ticker prev close.');
    }
  } catch (e) {
    notes.push(
      `Grouped daily failed (${e instanceof Error ? e.message : 'unknown'}) — falling back to per-ticker prev close.`,
    );
  }

  const alerts: WhaleAlert[] = [];
  const errors: Array<{ ticker: string; error: string }> = [];

  for (const t of tickers) {
    try {
      const alert = await scanTicker(t, groupedBars.get(t));
      if (alert) alerts.push(alert);
    } catch (e) {
      errors.push({ ticker: t, error: e instanceof Error ? e.message : String(e) });
    }
  }

  alerts.sort((a, b) => b.whaleScore - a.whaleScore);

  const result: WhaleScanResult = {
    scanTime: new Date().toISOString(),
    tickersScanned: tickers.length,
    alertsFound: alerts.length,
    alerts,
    errors,
    notes,
    cacheHit: false,
    cacheAgeSec: 0,
  };

  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS, storedAt: Date.now() });
  return result;
}

export function computeCombinedScore(
  medallionScore: number,
  whale: WhaleAlert,
): {
  combined: number;
  tradeDirection: TradeDirection;
} {
  const tradeDirection = whale.tradeDirection;

  let dirScore: number;
  if (tradeDirection === 'SELL_PUTS' || tradeDirection === 'SELL_CALLS') {
    const boosted =
      whale.flowAnalysis.signal === 'CONTRARIAN_BULLISH' ||
      whale.flowAnalysis.signal === 'CONTRARIAN_BEARISH';
    dirScore = boosted ? medallionScore : medallionScore;
  } else if (tradeDirection === 'IRON_CONDOR') {
    dirScore = medallionScore * 0.7;
  } else {
    dirScore = medallionScore * 0.5;
  }

  const combined = Math.min(
    100,
    Math.round(
      whale.whaleScore * 0.45 +
        dirScore * 0.35 +
        Math.min(100, whale.volumeRatio * 15) * 0.2,
    ),
  );

  return { combined, tradeDirection };
}
