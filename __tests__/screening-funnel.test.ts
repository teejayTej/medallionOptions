import { describe, expect, it } from 'vitest';
import {
  FUNNEL_STAGES,
  FUNNEL_THRESHOLDS,
  runFunnel,
  runFunnelOne,
  type FunnelInput,
} from '@/lib/engine/screening-funnel';
import type { TickerReference, EarningsInfo } from '@/lib/data/providers';
import type { TickerAnalysis } from '@/lib/engine/trade-engine';
import type { WhaleAlert } from '@/lib/engine/whale-scanner';

function makeReference(overrides: Partial<TickerReference> = {}): TickerReference {
  return {
    ticker: 'TEST',
    name: 'Test Co',
    marketCap: 50e9,
    tier: 'large',
    ...overrides,
  };
}

function makeEarnings(overrides: Partial<EarningsInfo> = {}): EarningsInfo {
  return {
    daysToEarnings: 30,
    earningsDate: '2026-05-25',
    hour: 'amc',
    available: true,
    source: 'finnhub',
    ...overrides,
  };
}

function makeMedallion(overrides: { ivRank?: number; medallionScore?: number; rsi?: number; vrp?: number; momentum12_1?: number } = {}): TickerAnalysis {
  return {
    ticker: 'TEST',
    price: 100,
    timestamp: new Date().toISOString(),
    signals: {
      zscore: 0,
      zscoreLookback: 20,
      rsi: overrides.rsi ?? 50,
      iv: 0.3,
      rv: 0.25,
      vrp: overrides.vrp ?? 0.05,
      ivRank: overrides.ivRank ?? 50,
      momentum12_1: overrides.momentum12_1 ?? 0.05,
    },
    regime: { state: 0, label: 'LOW VOL', targetDelta: 0.3, targetDTE: 45, sizeMultiplier: 1.0 },
    medallionScore: overrides.medallionScore ?? 75,
    stockSignal: 'BUY',
    gates: { putEntry: { pass: true, reasons: [], blocks: [] }, callEntry: { pass: true, reasons: [], blocks: [] }, icEntry: { pass: false, reasons: [], blocks: [] } },
    trades: [],
    notes: [],
  };
}

function makeWhale(overrides: Partial<WhaleAlert> = {}): WhaleAlert {
  return {
    ticker: 'TEST',
    price: 100,
    priceChange: 0.01,
    optionsVolume: 50_000,
    estimatedAvgVolume: 10_000,
    volumeRatio: 5,
    callVolume: 30_000,
    putVolume: 20_000,
    callPutRatio: 1.5,
    netDelta: 5000,
    totalOI: 100_000,
    callOI: 60_000,
    putOI: 40_000,
    largeContracts: [],
    totalLargeNotional: 500_000,
    netDeltaZ: 0,
    persistenceDays: 0,
    cumulativeAbnormalOI: 0,
    hasConcurrentOppositeLegWithin5Min: false,
    largeContractPremiumUSD: 500_000,
    borrowFeeBps: 50,
    whaleScore: 60,
    flowSignal: 'BULLISH_CONVICTION',
    flowAnalysis: {
      signal: 'BULLISH_CONVICTION',
      netDelta: 5000,
      netDeltaDirection: 'BULLISH',
      volumeDirection: 'CALL_HEAVY',
      agreementScore: 90,
      isContrarian: false,
      confidence: 0.75,
      explanation: 'Strong positive net Δ with 5x volume',
    },
    contrarian: { isContrarian: false, type: 'NONE', score: 0, explanation: 'No contrarian setup' },
    deltaProfile: { atmCallVolume: 15000, otmCallVolume: 15000, atmPutVolume: 10000, otmPutVolume: 10000, convictionRatio: 1.0, smartMoneySignal: 'ACCUMULATING' },
    tradeDirection: 'SELL_PUTS',
    urgency: 'HIGH',
    ...overrides,
  };
}

function passingInput(ticker = 'PASS'): FunnelInput {
  return {
    ticker,
    reference: makeReference({ ticker }),
    whale: makeWhale({ ticker }),
    medallion: makeMedallion(),
    earnings: makeEarnings(),
  };
}

describe('FUNNEL_STAGES + FUNNEL_THRESHOLDS', () => {
  it('exports 6 stages in order', () => {
    expect(FUNNEL_STAGES).toEqual(['universe', 'liquidity', 'volatility', 'earnings', 'whale', 'composite']);
  });
  it('exposes named thresholds', () => {
    expect(FUNNEL_THRESHOLDS.minTotalOI).toBe(50_000);
    expect(FUNNEL_THRESHOLDS.ivRankMin).toBe(20);
    expect(FUNNEL_THRESHOLDS.ivRankMax).toBe(90);
    expect(FUNNEL_THRESHOLDS.earningsClearDays).toBe(7);
    expect(FUNNEL_THRESHOLDS.minWhaleScore).toBe(30);
  });
});

describe('runFunnelOne — full pass', () => {
  it('clean input passes all 6 stages', () => {
    const r = runFunnelOne(passingInput());
    expect(r.passed).toBe(true);
    expect(r.stagesPassed).toBe(6);
    expect(r.failedAt).toBeNull();
    expect(r.compositeScore).not.toBeNull();
  });
});

describe('runFunnelOne — stage 1 universe', () => {
  it('rejects unknown tier', () => {
    const r = runFunnelOne({ ...passingInput(), reference: makeReference({ tier: 'unknown', marketCap: undefined }) });
    expect(r.passed).toBe(false);
    expect(r.failedAt).toBe('universe');
    expect(r.failedReason).toMatch(/Reference data unavailable/);
  });
  it('rejects small-cap', () => {
    const r = runFunnelOne({ ...passingInput(), reference: makeReference({ tier: 'small', marketCap: 1e9 }) });
    expect(r.passed).toBe(false);
    expect(r.failedAt).toBe('universe');
    expect(r.failedReason).toMatch(/below mid/);
  });
  it('accepts mid / large / mega', () => {
    for (const tier of ['mid', 'large', 'mega'] as const) {
      const r = runFunnelOne({ ...passingInput(), reference: makeReference({ tier }) });
      expect(r.trace[0].passed).toBe(true);
    }
  });
});

describe('runFunnelOne — stage 2 liquidity', () => {
  it('rejects total OI below floor', () => {
    const r = runFunnelOne({ ...passingInput(), whale: makeWhale({ totalOI: 30_000 }) });
    expect(r.failedAt).toBe('liquidity');
  });
  it('rejects null whale data', () => {
    const r = runFunnelOne({ ...passingInput(), whale: null });
    expect(r.failedAt).toBe('liquidity');
    expect(r.failedReason).toMatch(/No whale data/);
  });
});

describe('runFunnelOne — stage 3 volatility', () => {
  it('rejects IVR < 20 (depressed)', () => {
    const r = runFunnelOne({ ...passingInput(), medallion: makeMedallion({ ivRank: 15 }) });
    expect(r.failedAt).toBe('volatility');
    expect(r.failedReason).toMatch(/depressed/);
  });
  it('rejects IVR > 90 (panic)', () => {
    const r = runFunnelOne({ ...passingInput(), medallion: makeMedallion({ ivRank: 95 }) });
    expect(r.failedAt).toBe('volatility');
    expect(r.failedReason).toMatch(/panic|elevated/);
  });
  it('accepts IVR at boundaries', () => {
    const r1 = runFunnelOne({ ...passingInput(), medallion: makeMedallion({ ivRank: 20 }) });
    const r2 = runFunnelOne({ ...passingInput(), medallion: makeMedallion({ ivRank: 90 }) });
    expect(r1.trace[2].passed).toBe(true);
    expect(r2.trace[2].passed).toBe(true);
  });
});

describe('runFunnelOne — stage 4 earnings', () => {
  it('rejects earnings within 7 days', () => {
    const r = runFunnelOne({ ...passingInput(), earnings: makeEarnings({ daysToEarnings: 5 }) });
    expect(r.failedAt).toBe('earnings');
  });
  it('passes when earnings are unknown (provider unavailable)', () => {
    const r = runFunnelOne({
      ...passingInput(),
      earnings: { daysToEarnings: null, earningsDate: null, hour: null, available: false, source: 'no provider' },
    });
    expect(r.trace[3].passed).toBe(true);
  });
  it('passes when no earnings within 60d', () => {
    const r = runFunnelOne({
      ...passingInput(),
      earnings: { daysToEarnings: null, earningsDate: null, hour: null, available: true, source: 'finnhub' },
    });
    expect(r.trace[3].passed).toBe(true);
  });
});

describe('runFunnelOne — stage 5 whale', () => {
  it('rejects whale score < 30', () => {
    const r = runFunnelOne({ ...passingInput(), whale: makeWhale({ whaleScore: 25 }) });
    expect(r.failedAt).toBe('whale');
  });
});

describe('runFunnelOne — stage 6 composite', () => {
  it('rejects when V4 medallion score < 70 (V5_SCORING off)', () => {
    const r = runFunnelOne({ ...passingInput(), medallion: makeMedallion({ medallionScore: 55 }) });
    expect(r.failedAt).toBe('composite');
    expect(r.compositeScore).toBe(55);
  });
  it('passes at exactly threshold (70)', () => {
    const r = runFunnelOne({ ...passingInput(), medallion: makeMedallion({ medallionScore: 70 }) });
    expect(r.trace[5].passed).toBe(true);
    expect(r.compositeScore).toBe(70);
  });
  it('rejects when whale or medallion null (cannot compute)', () => {
    const r = runFunnelOne({ ...passingInput(), medallion: null });
    expect(r.compositeScore).toBeNull();
  });
});

describe('runFunnelOne — trace continues past first failure', () => {
  it('records all 6 stage attempts even after early failure', () => {
    const r = runFunnelOne({ ...passingInput(), reference: makeReference({ tier: 'small', marketCap: 1e9 }) });
    expect(r.trace.length).toBe(6);
    expect(r.failedAt).toBe('universe');
    // Downstream stages still run their predicates and produce trace entries.
  });
});

describe('runFunnel — aggregate', () => {
  it('classifies passed vs borderline vs failed correctly', () => {
    const inputs: FunnelInput[] = [
      passingInput('A'),
      // borderline: passes 5/6 (composite below 70)
      { ...passingInput('B'), medallion: makeMedallion({ medallionScore: 50 }) },
      // failed at stage 1 (passed 0/6)
      { ...passingInput('C'), reference: makeReference({ ticker: 'C', tier: 'small', marketCap: 1e9 }) },
    ];
    const summary = runFunnel(inputs);
    expect(summary.total).toBe(3);
    expect(summary.passed.map((r) => r.ticker)).toEqual(['A']);
    expect(summary.borderline.map((r) => r.ticker)).toEqual(['B']);
    expect(summary.failed.map((r) => r.ticker)).toEqual(['C']);
  });

  it('counts filteredAt by first-failure stage', () => {
    const inputs: FunnelInput[] = [
      // 2 fail at universe
      { ...passingInput('A1'), reference: makeReference({ ticker: 'A1', tier: 'small', marketCap: 1e9 }) },
      { ...passingInput('A2'), reference: makeReference({ ticker: 'A2', tier: 'unknown' }) },
      // 1 fails at liquidity
      { ...passingInput('B1'), whale: makeWhale({ totalOI: 10_000 }) },
      // 1 passes
      passingInput('C1'),
    ];
    const summary = runFunnel(inputs);
    expect(summary.filteredAt.universe).toBe(2);
    expect(summary.filteredAt.liquidity).toBe(1);
    expect(summary.filteredAt.composite).toBe(0);
    expect(summary.passed.length).toBe(1);
  });

  it('synthetic 80-ticker universe yields a rejection-rate consistent with the brief target (2-3/wk)', () => {
    // Build 80 inputs where ~3 are passing-quality, ~10 are borderline, rest fail.
    const inputs: FunnelInput[] = [];
    for (let i = 0; i < 80; i++) {
      const ticker = `T${i.toString().padStart(2, '0')}`;
      if (i < 3) {
        inputs.push(passingInput(ticker));
      } else if (i < 13) {
        // borderline — composite just below threshold
        inputs.push({ ...passingInput(ticker), medallion: makeMedallion({ medallionScore: 65 }) });
      } else if (i < 40) {
        // small caps
        inputs.push({ ...passingInput(ticker), reference: makeReference({ ticker, tier: 'small', marketCap: 1e9 }) });
      } else if (i < 60) {
        // low whale score
        inputs.push({ ...passingInput(ticker), whale: makeWhale({ ticker, whaleScore: 20 }) });
      } else {
        // earnings within window
        inputs.push({ ...passingInput(ticker), earnings: makeEarnings({ daysToEarnings: 3 }) });
      }
    }
    const summary = runFunnel(inputs);
    expect(summary.passed.length).toBe(3);
    expect(summary.borderline.length).toBe(10);
    expect(summary.failed.length).toBe(67);
    const passRate = summary.passed.length / summary.total;
    expect(passRate).toBeLessThan(0.05); // well under 5% — matches brief's "2-3 from 80" goal
  });
});
