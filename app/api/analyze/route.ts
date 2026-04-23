import { getPrevClose, getHistoricalBars, getOptionsChain } from '@/lib/data/polygon';
import { getVIX } from '@/lib/data/fred';
import { analyzeTicker, type TickerAnalysis } from '@/lib/engine/trade-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const UNIVERSE = [
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'JPM', 'SPY', 'QQQ',
  'AMD', 'NFLX', 'BA', 'GS', 'DIS', 'COIN', 'PLTR', 'XLE', 'IWM', 'XLF',
];

async function analyzeOne(
  ticker: string,
  portfolio: number,
  vix: number | undefined,
): Promise<TickerAnalysis | { ticker: string; error: string }> {
  try {
    const [snap, bars] = await Promise.all([getPrevClose(ticker), getHistoricalBars(ticker, 400)]);
    if (bars.length < 25) return { ticker, error: `Only ${bars.length} bars` };
    const prices = bars.map((b) => b.c);
    const chain = await getOptionsChain(ticker, snap.price);
    return analyzeTicker(ticker, snap.price, prices, chain, portfolio, vix);
  } catch (e) {
    return { ticker, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker');
  const portfolio = parseFloat(url.searchParams.get('portfolio') ?? '100000');
  const topN = parseInt(url.searchParams.get('top') ?? '3', 10);
  const universeParam = url.searchParams.get('universe');
  const universe = universeParam ? universeParam.split(',').map((t) => t.trim().toUpperCase()) : UNIVERSE;

  try {
    const vix = await getVIX();

    if (ticker) {
      const result = await analyzeOne(ticker.toUpperCase(), portfolio, vix);
      return Response.json({ vix, result });
    }

    const all: Array<TickerAnalysis | { ticker: string; error: string }> = [];
    for (const t of universe) {
      all.push(await analyzeOne(t, portfolio, vix));
    }

    const successes = all.filter((r): r is TickerAnalysis => !('error' in r));
    const errors = all.filter((r): r is { ticker: string; error: string } => 'error' in r);

    const ranked = [...successes].sort((a, b) => b.medallionScore - a.medallionScore);
    const withTrades = ranked.filter((r) => r.trades.length > 0);
    const topTrades = withTrades.slice(0, topN);

    return Response.json({
      timestamp: new Date().toISOString(),
      vix,
      regime: ranked[0]?.regime ?? null,
      counts: {
        universe: universe.length,
        analyzed: successes.length,
        errored: errors.length,
        withTrades: withTrades.length,
      },
      errors,
      top: topTrades,
      allRanked: ranked.map((r) => ({
        ticker: r.ticker,
        price: r.price,
        score: r.medallionScore,
        signal: r.stockSignal,
        regime: r.regime.label,
        trades: r.trades.length,
        vrp: r.signals.vrp,
        ivRank: r.signals.ivRank,
        zscore: r.signals.zscore,
        putGate: r.gates.putEntry.pass,
        callGate: r.gates.callEntry.pass,
        notes: r.notes,
      })),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
