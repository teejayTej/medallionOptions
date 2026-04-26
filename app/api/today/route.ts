import { runWhaleScan, type WhaleAlert } from '@/lib/engine/whale-scanner';
import { analyzeTicker } from '@/lib/engine/trade-engine';
import { getHistoricalBars, getOptionsChain } from '@/lib/data/polygon';
import { getVIX } from '@/lib/data/fred';
import { getTickerReference, getDaysToEarnings } from '@/lib/data/providers';
import { scoreUnified, type ScoredTicker } from '@/lib/engine/scoring';

export const dynamic = 'force-dynamic';
export const maxDuration = 3600;

interface CacheEntry {
  data: TodayResponse;
  expiresAt: number;
  storedAt: number;
  /** True while a background refresh is computing a fresh value. */
  refreshing: boolean;
}
/** Hard cap on cached entry; we serve stale up to this even after expiry. */
const CACHE_TTL_MS = 15 * 60_000;
const STALE_GRACE_MS = 60 * 60_000; // can serve up to 60 min old while revalidating
const cache = new Map<string, CacheEntry>();

interface TodayResponse {
  scanTime: string;
  vix?: number;
  regime: string | null;
  portfolioValue: number;
  cacheHit: boolean;
  cacheAgeSec: number;
  /** True when we returned stale data and a fresh fetch is happening in the background. */
  staleWhileRevalidate: boolean;
  counts: { universe: number; scored: number; must_try: number; top_10: number; scanner: number; blocked: number };
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
    // Attach the trimmed price history for sparkline consumers.
    (medallion as unknown as { prices: number[] }).prices = prices;

    const score = scoreUnified({ ticker, whale, medallion, chain, reference, earnings, portfolioValue });

    return { scored: { ticker, price: whale.price, score, whale, medallion, reference, earnings } };
  } catch (e) {
    return { scored: null, error: e instanceof Error ? e.message : String(e) };
  }
}

function cacheKey(universe: string[] | undefined, portfolio: number): string {
  const u = universe ? [...universe].sort().join(',') : 'default';
  return `v1:${u}:${portfolio}`;
}

async function buildFresh(
  universe: string[] | undefined,
  portfolio: number,
  maxAnalyze: number,
  bypassWhaleCache: boolean,
): Promise<TodayResponse> {
  const vix = await getVIX().catch(() => undefined);
  const whaleResult = await runWhaleScan(universe, { bypassCache: bypassWhaleCache });

  const candidates = whaleResult.alerts.slice(0, maxAnalyze);
  const errors: Array<{ ticker: string; error: string }> = [];
  const scoredList: ScoredTicker[] = [];

  // Parallel batches. Polygon Developer ($79) handles them comfortably.
  const BATCH = 8;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const slice = candidates.slice(i, i + BATCH);
    const results = await Promise.all(slice.map((w) => scoreOne(w, portfolio, vix)));
    for (let j = 0; j < results.length; j++) {
      const { scored, error } = results[j];
      if (scored) scoredList.push(scored);
      else if (error) errors.push({ ticker: slice[j].ticker, error });
    }
  }

  scoredList.sort((a, b) => b.score.total - a.score.total);

  const mustTry = scoredList.filter((s) => s.score.tier === 'must_try').slice(0, 5);
  const topTen = scoredList.filter((s) => s.score.tier === 'top_10').slice(0, 10);
  const scanner = scoredList.filter((s) => s.score.tier === 'scanner').slice(0, 25);
  const blocked = scoredList
    .filter((s) => s.score.tier === 'blocked')
    .map((s) => ({
      ticker: s.ticker,
      reason: s.score.gates.filter((g) => !g.passed).map((g) => g.reason).join(' · '),
    }));

  return {
    scanTime: new Date().toISOString(),
    vix,
    regime: scoredList[0]?.medallion?.regime.label ?? null,
    portfolioValue: portfolio,
    cacheHit: false,
    cacheAgeSec: 0,
    staleWhileRevalidate: false,
    counts: {
      universe: whaleResult.tickersScanned,
      scored: scoredList.length,
      must_try: mustTry.length,
      top_10: topTen.length,
      scanner: scanner.length,
      blocked: blocked.length,
    },
    mustTry,
    topTen,
    scanner,
    blocked,
    errors: [...whaleResult.errors, ...errors],
    notes: [
      ...whaleResult.notes,
      `Scored top ${candidates.length} of ${whaleResult.alertsFound} whale alerts (limit=${maxAnalyze}).`,
      'Data is 15-min delayed (Polygon Developer); no real-time NBBO.',
    ],
  };
}

function backgroundRefresh(ck: string, universe: string[] | undefined, portfolio: number, maxAnalyze: number): void {
  const entry = cache.get(ck);
  if (entry?.refreshing) return;
  cache.set(ck, { ...(entry ?? ({} as CacheEntry)), refreshing: true } as CacheEntry);
  buildFresh(universe, portfolio, maxAnalyze, true)
    .then((data) => {
      cache.set(ck, {
        data,
        expiresAt: Date.now() + CACHE_TTL_MS,
        storedAt: Date.now(),
        refreshing: false,
      });
    })
    .catch((e) => {
      console.error('[today] background refresh failed:', e);
      const cur = cache.get(ck);
      if (cur) cache.set(ck, { ...cur, refreshing: false });
    });
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

  // 1. Fresh cache hit — return immediately.
  if (!refresh) {
    const entry = cache.get(ck);
    if (entry?.data && entry.expiresAt > Date.now()) {
      const ageSec = Math.round((Date.now() - entry.storedAt) / 1000);
      return Response.json({ ...entry.data, cacheHit: true, cacheAgeSec: ageSec });
    }

    // 2. Stale-while-revalidate: serve stale cache (up to 60 min old) and
    //    kick off a background refresh that updates the cache for next time.
    if (entry?.data) {
      const ageMs = Date.now() - entry.storedAt;
      if (ageMs < STALE_GRACE_MS) {
        backgroundRefresh(ck, universe, portfolio, maxAnalyze);
        const ageSec = Math.round(ageMs / 1000);
        return Response.json({
          ...entry.data,
          cacheHit: true,
          cacheAgeSec: ageSec,
          staleWhileRevalidate: true,
          notes: [
            `Stale-while-revalidate: served ${ageSec}s-old cache; refresh running in background.`,
            ...entry.data.notes,
          ],
        });
      }
    }
  }

  // 3. No cache or refresh forced — block on a fresh build.
  try {
    const data = await buildFresh(universe, portfolio, maxAnalyze, refresh);
    cache.set(ck, { data, expiresAt: Date.now() + CACHE_TTL_MS, storedAt: Date.now(), refreshing: false });
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
