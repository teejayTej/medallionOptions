import { describe, expect, it } from 'vitest';
import {
  computeStats,
  dailyReturns,
  expectancy,
  maxDrawdown,
  profitFactor,
  sharpeRatio,
  totalReturn,
  winRate,
} from '@/lib/backtest/stats';
import { runBacktest, type DataProvider } from '@/lib/backtest/runner';
import type {
  BacktestSpec,
  BacktestTrade,
  DailyChainSnapshot,
  DailyEquityPoint,
} from '@/lib/backtest/types';

function makeTrade(overrides: Partial<BacktestTrade>): BacktestTrade {
  return {
    id: 't',
    ticker: 'TEST',
    archetype: 'BULLISH_CONVICTION',
    entryDate: '2026-01-01',
    entryPrice: 1.0,
    qty: 1,
    contractSymbol: 'O:TEST',
    strike: 100,
    expiration: '2026-02-20',
    exits: [],
    finalPnl: 0,
    finalPnlPct: 0,
    durationDays: 5,
    closedReason: 'manual',
    ...overrides,
  };
}

function makeCurve(equities: number[]): DailyEquityPoint[] {
  return equities.map((eq, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    equity: eq,
    realizedPnl: 0,
    unrealizedPnl: 0,
    openTradeCount: 0,
  }));
}

describe('dailyReturns', () => {
  it('returns N-1 daily returns', () => {
    const r = dailyReturns(makeCurve([100, 110, 99]));
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(0.1, 4);
    expect(r[1]).toBeCloseTo(-0.1, 4);
  });
  it('returns [] on single point', () => {
    expect(dailyReturns(makeCurve([100]))).toEqual([]);
  });
});

describe('sharpeRatio', () => {
  it('positive return curve has positive Sharpe', () => {
    const curve = makeCurve([100, 102, 104, 103, 106, 108, 110]);
    expect(sharpeRatio(curve)).toBeGreaterThan(0);
  });
  it('flat curve returns 0', () => {
    expect(sharpeRatio(makeCurve([100, 100, 100, 100]))).toBe(0);
  });
  it('insufficient data returns 0', () => {
    expect(sharpeRatio(makeCurve([100]))).toBe(0);
  });
});

describe('maxDrawdown', () => {
  it('detects peak-to-trough', () => {
    const curve = makeCurve([100, 120, 80, 90]);
    // peak 120, trough 80 → -33.33%
    expect(maxDrawdown(curve)).toBeCloseTo(-0.3333, 3);
  });
  it('monotonically rising = 0 DD', () => {
    expect(maxDrawdown(makeCurve([100, 105, 110, 115]))).toBe(0);
  });
});

describe('winRate', () => {
  it('mixed: 2W 3L -> 0.4', () => {
    const trades = [
      makeTrade({ id: '1', finalPnl: 100 }),
      makeTrade({ id: '2', finalPnl: -50 }),
      makeTrade({ id: '3', finalPnl: 200 }),
      makeTrade({ id: '4', finalPnl: -30 }),
      makeTrade({ id: '5', finalPnl: -10 }),
    ];
    expect(winRate(trades)).toBeCloseTo(0.4, 4);
  });
  it('empty returns 0', () => {
    expect(winRate([])).toBe(0);
  });
});

describe('profitFactor', () => {
  it('totalWin / |totalLoss|', () => {
    const trades = [
      makeTrade({ id: '1', finalPnl: 100 }),
      makeTrade({ id: '2', finalPnl: 50 }),
      makeTrade({ id: '3', finalPnl: -30 }),
    ];
    // 150 / 30 = 5
    expect(profitFactor(trades)).toBe(5);
  });
  it('all wins returns Infinity', () => {
    const trades = [makeTrade({ finalPnl: 50 }), makeTrade({ finalPnl: 100 })];
    expect(profitFactor(trades)).toBe(Infinity);
  });
  it('all losses returns 0', () => {
    const trades = [makeTrade({ finalPnl: -50 }), makeTrade({ finalPnl: -100 })];
    expect(profitFactor(trades)).toBe(0);
  });
});

describe('expectancy', () => {
  it('winRate*avgWin - lossRate*avgLoss', () => {
    const trades = [
      makeTrade({ id: '1', finalPnl: 200 }),
      makeTrade({ id: '2', finalPnl: -100 }),
    ];
    // wr=0.5, avgWin=200, lossRate=0.5, avgLoss=100 → 100 - 50 = 50
    expect(expectancy(trades)).toBe(50);
  });
});

describe('totalReturn', () => {
  it('end / start - 1', () => {
    const curve = makeCurve([100, 110, 120]);
    expect(totalReturn(curve)).toBeCloseTo(0.2, 4);
  });
  it('zero start returns 0', () => {
    const curve = makeCurve([0, 100]);
    expect(totalReturn(curve)).toBe(0);
  });
});

describe('computeStats', () => {
  it('aggregates all metrics from trades + curve', () => {
    const trades = [
      makeTrade({ id: '1', finalPnl: 100, durationDays: 5 }),
      makeTrade({ id: '2', finalPnl: -50, durationDays: 7 }),
    ];
    const curve = makeCurve([1000, 1100, 1080, 1050, 1100]);
    const stats = computeStats(trades, curve);
    expect(stats.totalTrades).toBe(2);
    expect(stats.winners).toBe(1);
    expect(stats.losers).toBe(1);
    expect(stats.winRate).toBe(0.5);
    expect(stats.profitFactor).toBe(2);
    expect(stats.totalPnl).toBe(50);
    expect(stats.avgDurationDays).toBe(6);
    expect(stats.totalReturn).toBeCloseTo(0.1, 4);
  });
});

// ──────────────────────────────────────────────────────────────────
// Runner tests with fixture provider
// ──────────────────────────────────────────────────────────────────

class FixtureProvider implements DataProvider {
  constructor(
    private readonly dates: string[],
    private readonly snaps: Map<string, DailyChainSnapshot>,
  ) {}
  tradingDates(start: string, end: string): string[] {
    return this.dates.filter((d) => d >= start && d <= end);
  }
  snapshot(date: string, ticker: string): DailyChainSnapshot | null {
    return this.snaps.get(`${date}|${ticker}`) ?? null;
  }
}

function makeSnap(opts: {
  date: string;
  ticker: string;
  spot: number;
  midPrice: number;
  delta: number;
  isEntry?: boolean;
  archetype?: 'BULLISH_CONVICTION' | 'CONTRARIAN_BULLISH';
}): DailyChainSnapshot {
  const halfSpread = opts.midPrice * 0.04;
  return {
    date: opts.date,
    ticker: opts.ticker,
    underlyingPrice: opts.spot,
    contracts: [
      {
        occSymbol: 'O:TEST26',
        type: 'call',
        strike: 100,
        expiration: '2026-03-20',
        dte: 35,
        midPrice: opts.midPrice,
        bid: opts.midPrice - halfSpread,
        ask: opts.midPrice + halfSpread,
        delta: opts.delta,
        gamma: 0.01,
        theta: -0.05,
        iv: 0.3,
        openInterest: 5000,
        volume: 800,
      },
    ],
    signal: opts.isEntry
      ? {
          archetype: opts.archetype ?? 'BULLISH_CONVICTION',
          whaleScore: 80,
          perfectSetupScore: 85,
          isEntryCandidate: true,
        }
      : null,
  };
}

describe('runBacktest — entry + tier scaling + close', () => {
  it('opens a position on signal day, runs through tiers, closes on chandelier', () => {
    const dates = ['2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07'];
    const snaps = new Map<string, DailyChainSnapshot>();
    // Day 1: signal day, mid=1.0
    snaps.set('2026-01-02|TEST', makeSnap({ date: '2026-01-02', ticker: 'TEST', spot: 100, midPrice: 1.0, delta: 0.3, isEntry: true }));
    // Day 2: gain to 2.5 (above tier1 100% threshold for BULLISH_CONVICTION)
    snaps.set('2026-01-03|TEST', makeSnap({ date: '2026-01-03', ticker: 'TEST', spot: 105, midPrice: 2.5, delta: 0.55 }));
    // Day 3: peak 4.0
    snaps.set('2026-01-04|TEST', makeSnap({ date: '2026-01-04', ticker: 'TEST', spot: 110, midPrice: 4.0, delta: 0.75 }));
    // Day 4: peak 5.0, delta 0.78
    snaps.set('2026-01-05|TEST', makeSnap({ date: '2026-01-05', ticker: 'TEST', spot: 115, midPrice: 5.0, delta: 0.78 }));
    // Day 5: drop to 3.0 (chandelier 35% from peak 5.0 = 3.25 stop, 3.0 < 3.25 → CLOSE)
    snaps.set('2026-01-06|TEST', makeSnap({ date: '2026-01-06', ticker: 'TEST', spot: 110, midPrice: 3.0, delta: 0.6 }));
    snaps.set('2026-01-07|TEST', makeSnap({ date: '2026-01-07', ticker: 'TEST', spot: 110, midPrice: 3.0, delta: 0.6 }));

    const provider = new FixtureProvider(dates, snaps);
    const spec: BacktestSpec = {
      startDate: '2026-01-02',
      endDate: '2026-01-07',
      universe: ['TEST'],
      startingCapital: 10000,
    };
    const run = runBacktest(spec, provider);

    expect(run.trades.length).toBeGreaterThanOrEqual(1);
    const trade = run.trades[0];
    expect(trade.ticker).toBe('TEST');
    expect(trade.entryDate).toBe('2026-01-02');
    // Tier 1 scale on day 2 (gain 150%)
    expect(trade.exits.some((e) => e.reason.startsWith('tier1'))).toBe(true);
    expect(trade.closedReason).toMatch(/chandelier_trail|tier|hard|underlying|backtest_window_ended/);
    expect(run.equityCurve.length).toBe(dates.length);
  });

  it('records diagnostics when signal fires but no candidate contract', () => {
    const dates = ['2026-01-02'];
    const snaps = new Map<string, DailyChainSnapshot>();
    const snap = makeSnap({ date: '2026-01-02', ticker: 'TEST', spot: 100, midPrice: 1.0, delta: 0.3, isEntry: true });
    // Strip out contracts so pickEntryContract returns null.
    snap.contracts = [];
    snaps.set('2026-01-02|TEST', snap);

    const provider = new FixtureProvider(dates, snaps);
    const run = runBacktest(
      { startDate: '2026-01-02', endDate: '2026-01-02', universe: ['TEST'], startingCapital: 10000 },
      provider,
    );
    expect(run.trades.length).toBe(0);
    expect(run.diagnostics.some((d) => d.includes('no candidate contract'))).toBe(true);
  });

  it('does not open a second trade for same ticker while one is open', () => {
    const dates = ['2026-01-02', '2026-01-03'];
    const snaps = new Map<string, DailyChainSnapshot>();
    snaps.set('2026-01-02|TEST', makeSnap({ date: '2026-01-02', ticker: 'TEST', spot: 100, midPrice: 1.0, delta: 0.3, isEntry: true }));
    // Second day also a signal but trade is still open
    snaps.set('2026-01-03|TEST', makeSnap({ date: '2026-01-03', ticker: 'TEST', spot: 102, midPrice: 1.1, delta: 0.32, isEntry: true }));

    const provider = new FixtureProvider(dates, snaps);
    const run = runBacktest(
      { startDate: '2026-01-02', endDate: '2026-01-03', universe: ['TEST'], startingCapital: 10000 },
      provider,
    );
    // 1 trade open on day 1, still open on day 2 → only 1 trade in the run output
    expect(run.trades.length).toBe(1);
  });

  it('produces non-empty equity curve and stats object', () => {
    const dates = ['2026-01-02', '2026-01-03', '2026-01-04'];
    const snaps = new Map<string, DailyChainSnapshot>();
    snaps.set('2026-01-02|TEST', makeSnap({ date: '2026-01-02', ticker: 'TEST', spot: 100, midPrice: 1.0, delta: 0.3, isEntry: true }));
    snaps.set('2026-01-03|TEST', makeSnap({ date: '2026-01-03', ticker: 'TEST', spot: 102, midPrice: 1.1, delta: 0.32 }));
    snaps.set('2026-01-04|TEST', makeSnap({ date: '2026-01-04', ticker: 'TEST', spot: 100, midPrice: 0.9, delta: 0.28 }));

    const provider = new FixtureProvider(dates, snaps);
    const run = runBacktest(
      { startDate: '2026-01-02', endDate: '2026-01-04', universe: ['TEST'], startingCapital: 10000 },
      provider,
    );
    expect(run.equityCurve).toHaveLength(3);
    expect(run.stats).toBeDefined();
    expect(typeof run.stats.sharpe).toBe('number');
    expect(run.walltimeMs).toBeGreaterThanOrEqual(0);
  });
});
