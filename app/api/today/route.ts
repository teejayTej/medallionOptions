import { runWhaleScan, type WhaleAlert } from '@/lib/engine/whale-scanner';
import { analyzeTicker } from '@/lib/engine/trade-engine';
import { getHistoricalBars, getOptionsChain } from '@/lib/data/polygon';
import { getVIX } from '@/lib/data/fred';
import { getTickerReference, getDaysToEarnings } from '@/lib/data/providers';
import { scoreUnified, type ScoredTicker, type Tier } from '@/lib/engine/scoring';

export const dynamic = 'force-dynamic';
export const maxDuration = 3600;

interface CacheEntry {
  data: TodayResponse;
  expiresAt: number;
  storedAt: number;
}
const TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

interface TodayResponse {
  scanTime: string;
  vix?: number;
  regime: string | null;
  portfolioValue: number;
  cacheHit: boolean;
  cacheAgeSec: number;
  counts: {
    universe: number;
    scored: number;
    must_try: number;
    top_10: number;
    scanner: number;
    blocked: number;
  };
  mustTry: ScoredTicker[];
  topTen: ScoredTicker[];
  scanner: ScoredTicker[];
  blocked: Array<{ ticker: string; reason: string }>;
  errors: Array<{ ticker: string; error: string }>;
  notes: string[];
}

async function scoreOne(
  whale: WhaleAlert,
  portfolioValue: number,
  vix: number | undefined,
): Promise<{ scored: ScoredTicker | null; error?: string }> {
  const ticker = whale.ticker;
  try {
    const [bars, chain, reference, earnings] = await Promise.all([
      getHistoricalBars(ticker, 400).catch(() => []),
      getOptionsChain(ticker, whale.price).catch(() => []),
      getTickerReference(ticker),
      getDaysToEarnings(ticker),
    ]);

    if (bars.length < 25) {
      return { scored: null, error: `Only ${bars.length} historical bars` };
    }
    const prices = bars.map((b) => b.c);
    const medallion = analyzeTicker(ticker, whale.price, prices, chain, portfolioValue, vix);

    const score = scoreUnified({
      ticker,
      whale,
      medallion,
      chain,
      reference,
      earnings,
      portfolioValue,
    });

    return {
      scored: { ticker, price: whale.price, score, whale, medallion, reference, earnings },
    };
  } catch (e) {
    return { scored: null, error: e instanceof Error ? e.message : String(e) };
  }
}

function cacheKey(universe: string[] | undefined, portfolio: number): string {
  const u = universe ? [...universe].sort().join(',') : 'default';
  return `v1:${u}:${portfolio}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const portfolio = parseFloat(url.searchParams.get('portfolio') ?? '100000');
  const universeParam = url.searchParams.get('universe');
  const universe = universeParam
    ? universeParam.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean)
    : undefined;
  const refresh = url.searchParams.get('refresh') === '1';
  const maxAnalyze = parseInt(url.searchParams.get('limit') ?? '15', 10);

  const ck = cacheKey(universe, portfolio);
  if (!refresh) {
    const entry = cache.get(ck);
    if (entry && entry.expiresAt > Date.now()) {
      const ageSec = Math.round((Date.now() - entry.storedAt) / 1000);
      return Response.json({ ...entry.data, cacheHit: true, cacheAgeSec: ageSec });
    }
  }

  try {
    const vix = await getVIX().catch(() => undefined);
    const whaleResult = await runWhaleScan(universe, { bypassCache: refresh });

    const candidates = whaleResult.alerts.slice(0, maxAnalyze);
    const errors: Array<{ ticker: string; error: string }> = [];
    const scoredList: ScoredTicker[] = [];

    for (const w of candidates) {
      const { scored, error } = await scoreOne(w, portfolio, vix);
      if (scored) scoredList.push(scored);
      else if (error) errors.push({ ticker: w.ticker, error });
    }

    scoredList.sort((a, b) => b.score.total - a.score.total);

    const mustTry = scoredList.filter((s) => s.score.tier === 'must_try').slice(0, 5);
    const topTen = scoredList.filter((s) => s.score.tier === 'top_10').slice(0, 10);
    const scanner = scoredList.filter((s) => s.score.tier === 'scanner').slice(0, 25);
    const blocked = scoredList
      .filter((s) => s.score.tier === 'blocked')
      .map((s) => ({
        ticker: s.ticker,
        reason: s.score.gates
          .filter((g) => !g.passed)
          .map((g) => g.reason)
          .join(' · '),
      }));

    const counts = {
      universe: whaleResult.tickersScanned,
      scored: scoredList.length,
      must_try: mustTry.length,
      top_10: topTen.length,
      scanner: scanner.length,
      blocked: blocked.length,
    };

    const data: TodayResponse = {
      scanTime: new Date().toISOString(),
      vix,
      regime: scoredList[0]?.medallion?.regime.label ?? null,
      portfolioValue: portfolio,
      cacheHit: false,
      cacheAgeSec: 0,
      counts,
      mustTry,
      topTen,
      scanner,
      blocked,
      errors: [...whaleResult.errors, ...errors],
      notes: [
        ...whaleResult.notes,
        `Scored top ${candidates.length} of ${whaleResult.alertsFound} whale alerts (limit=${maxAnalyze}).`,
        'Live streaming unavailable on Polygon Starter — data is 15-min polled.',
      ],
    };

    cache.set(ck, { data, expiresAt: Date.now() + TTL_MS, storedAt: Date.now() });
    return Response.json(data);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
