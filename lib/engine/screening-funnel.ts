// V5 Phase 6 — Six-stage screening funnel.
//
// The brief targets 2–3 actionable trades per week from ~80 tickers.
// That's roughly a 95–97% rejection rate. A sequential funnel makes
// the rejection observable: each stage filters from the previous
// stage's output, and we log where every ticker fell out. The result
// is calibrated empirically — if real-world output is too sparse or
// too noisy, individual stage thresholds are tuned, not the structure.
//
// Stages (run in order):
//
//   1. UNIVERSE      — listed, has options, mid-cap or larger
//   2. LIQUIDITY     — total OI floor (proxy for tradability since
//                      we have no NBBO on Polygon Developer)
//   3. VOLATILITY    — IV rank in [20, 90] (avoid IV extremes)
//   4. EARNINGS      — clear of earnings (>7 days away or unknown)
//   5. WHALE         — whale score >= 30 (scanner-tier or better)
//   6. COMPOSITE     — Perfect Setup score >= ENTRY_SCORE_THRESHOLD (70)
//                      when V5_SCORING is on; else V4 unified score >= 70

import type { TickerReference, EarningsInfo } from '@/lib/data/providers';
import type { TickerAnalysis } from '@/lib/engine/trade-engine';
import type { WhaleAlert } from '@/lib/engine/whale-scanner';
import {
  computePerfectSetupScore,
  ENTRY_SCORE_THRESHOLD,
  mapWhaleSignalToArchetype,
  type PerfectSetupInputs,
} from '@/lib/engine/scoring';
import { FEATURES } from '@/lib/config/features';

export type FunnelStageName =
  | 'universe'
  | 'liquidity'
  | 'volatility'
  | 'earnings'
  | 'whale'
  | 'composite';

export const FUNNEL_STAGES: FunnelStageName[] = [
  'universe',
  'liquidity',
  'volatility',
  'earnings',
  'whale',
  'composite',
];

export interface FunnelInput {
  ticker: string;
  reference: TickerReference;
  whale: WhaleAlert | null;
  medallion: TickerAnalysis | null;
  earnings: EarningsInfo;
}

export interface StageTrace {
  stage: FunnelStageName;
  passed: boolean;
  reason: string;
}

export interface FunnelResult {
  ticker: string;
  passed: boolean;
  stagesPassed: number;
  failedAt: FunnelStageName | null;
  failedReason: string | null;
  trace: StageTrace[];
  /** Composite score (PerfectSetup or V4 fallback) computed at stage 6, even if upstream stages failed. */
  compositeScore: number | null;
}

export interface FunnelSummary {
  total: number;
  passed: FunnelResult[];
  borderline: FunnelResult[];
  failed: FunnelResult[];
  filteredAt: Record<FunnelStageName, number>;
  notes: string[];
}

// ──────────────────────────────────────────────────────────────────
// Stage thresholds (named so they can be tuned after live data)
// ──────────────────────────────────────────────────────────────────

export const FUNNEL_THRESHOLDS = {
  /** Mid-cap+ minimum (under this we don't have enough flow). */
  minMarketCapTier: ['mid', 'large', 'mega'] as const,
  /** Total options OI across the chain. Stand-in for spread quality. */
  minTotalOI: 50_000,
  /** IV rank window — avoid both depressed-IV calm and panic-IV chaos. */
  ivRankMin: 20,
  ivRankMax: 90,
  /** Earnings buffer — match V4/V5 gate convention. */
  earningsClearDays: 7,
  /** Whale score floor — scanner-tier requires >= 30 in current scoring.ts. */
  minWhaleScore: 30,
  /** Composite score floor — Perfect Setup ENTRY_SCORE_THRESHOLD (70). */
  minCompositeScore: ENTRY_SCORE_THRESHOLD,
} as const;

// ──────────────────────────────────────────────────────────────────
// Per-stage predicates
// ──────────────────────────────────────────────────────────────────

function checkUniverse(i: FunnelInput): StageTrace {
  const tier = i.reference.tier;
  if (tier === 'unknown') {
    return { stage: 'universe', passed: false, reason: 'Reference data unavailable (tier=unknown)' };
  }
  if (!(FUNNEL_THRESHOLDS.minMarketCapTier as readonly string[]).includes(tier)) {
    return { stage: 'universe', passed: false, reason: `Market cap tier ${tier} below mid` };
  }
  return {
    stage: 'universe',
    passed: true,
    reason: `Listed mid-cap+ (${tier}, $${i.reference.marketCap ? (i.reference.marketCap / 1e9).toFixed(1) + 'B' : '?'})`,
  };
}

function checkLiquidity(i: FunnelInput): StageTrace {
  if (!i.whale) {
    return { stage: 'liquidity', passed: false, reason: 'No whale data — liquidity unknown' };
  }
  if (i.whale.totalOI < FUNNEL_THRESHOLDS.minTotalOI) {
    return {
      stage: 'liquidity',
      passed: false,
      reason: `Total OI ${i.whale.totalOI.toLocaleString()} < ${FUNNEL_THRESHOLDS.minTotalOI.toLocaleString()} floor`,
    };
  }
  return {
    stage: 'liquidity',
    passed: true,
    reason: `Total OI ${i.whale.totalOI.toLocaleString()}`,
  };
}

function checkVolatility(i: FunnelInput): StageTrace {
  if (!i.medallion) {
    return { stage: 'volatility', passed: false, reason: 'No Medallion analysis — IV rank unknown' };
  }
  const ivr = i.medallion.signals.ivRank;
  if (ivr < FUNNEL_THRESHOLDS.ivRankMin) {
    return {
      stage: 'volatility',
      passed: false,
      reason: `IVR ${ivr.toFixed(0)} < ${FUNNEL_THRESHOLDS.ivRankMin} — IV depressed, premium too cheap`,
    };
  }
  if (ivr > FUNNEL_THRESHOLDS.ivRankMax) {
    return {
      stage: 'volatility',
      passed: false,
      reason: `IVR ${ivr.toFixed(0)} > ${FUNNEL_THRESHOLDS.ivRankMax} — IV elevated, panic regime`,
    };
  }
  return { stage: 'volatility', passed: true, reason: `IVR ${ivr.toFixed(0)}` };
}

function checkEarnings(i: FunnelInput): StageTrace {
  if (!i.earnings.available || i.earnings.daysToEarnings === null) {
    // Match the V5 scoring gate: if earnings provider unavailable, pass with note.
    return { stage: 'earnings', passed: true, reason: `No upcoming earnings (${i.earnings.source})` };
  }
  if (i.earnings.daysToEarnings <= FUNNEL_THRESHOLDS.earningsClearDays) {
    return {
      stage: 'earnings',
      passed: false,
      reason: `Earnings in ${i.earnings.daysToEarnings}d (need >${FUNNEL_THRESHOLDS.earningsClearDays})`,
    };
  }
  return {
    stage: 'earnings',
    passed: true,
    reason: `Earnings clear (${i.earnings.daysToEarnings}d away)`,
  };
}

function checkWhale(i: FunnelInput): StageTrace {
  if (!i.whale) {
    return { stage: 'whale', passed: false, reason: 'No whale alert' };
  }
  if (i.whale.whaleScore < FUNNEL_THRESHOLDS.minWhaleScore) {
    return {
      stage: 'whale',
      passed: false,
      reason: `Whale score ${i.whale.whaleScore} < ${FUNNEL_THRESHOLDS.minWhaleScore}`,
    };
  }
  return {
    stage: 'whale',
    passed: true,
    reason: `Whale ${i.whale.whaleScore} (${i.whale.flowSignal.replace(/_/g, ' ')})`,
  };
}

/**
 * Compute Perfect Setup score (when V5 inputs available) or fall back
 * to Medallion's V4 weighted score. Returns null when neither is possible.
 */
function computeCompositeScore(i: FunnelInput): number | null {
  if (!i.whale || !i.medallion) return null;
  if (FEATURES.V5_SCORING) {
    const archetype = mapWhaleSignalToArchetype(i.whale.flowSignal);
    const inputs: PerfectSetupInputs = {
      netDeltaZ: i.whale.netDeltaZ,
      volumeRatio: i.whale.volumeRatio,
      persistenceDays: i.whale.persistenceDays,
      cumulativeAbnormalOI: i.whale.cumulativeAbnormalOI,
      largeContractPremium: i.whale.largeContractPremiumUSD,
      deltaProfile: i.whale.deltaProfile.smartMoneySignal,
      ivRank: i.medallion.signals.ivRank,
      momentum12_1: i.medallion.signals.momentum12_1,
      borrowFeeBps: i.whale.borrowFeeBps,
      rsi14: i.medallion.signals.rsi,
      vrp: i.medallion.signals.vrp,
      archetype,
    };
    return computePerfectSetupScore(inputs);
  }
  // V4 fallback — Medallion score is the proxy.
  return i.medallion.medallionScore;
}

function checkComposite(i: FunnelInput): { trace: StageTrace; score: number | null } {
  const score = computeCompositeScore(i);
  if (score === null) {
    return {
      trace: {
        stage: 'composite',
        passed: false,
        reason: 'Cannot compute composite (whale or Medallion data missing)',
      },
      score: null,
    };
  }
  if (score < FUNNEL_THRESHOLDS.minCompositeScore) {
    return {
      trace: {
        stage: 'composite',
        passed: false,
        reason: `Composite ${score} < ${FUNNEL_THRESHOLDS.minCompositeScore} threshold`,
      },
      score,
    };
  }
  return {
    trace: { stage: 'composite', passed: true, reason: `Composite ${score} >= ${FUNNEL_THRESHOLDS.minCompositeScore}` },
    score,
  };
}

// ──────────────────────────────────────────────────────────────────
// Funnel runner
// ──────────────────────────────────────────────────────────────────

/**
 * Run a single ticker through all 6 stages. Stages run sequentially
 * but every stage produces a trace entry, even after the first failure,
 * so the user can see which downstream stages would also have rejected.
 * The composite score is always computed (when possible) for telemetry.
 */
export function runFunnelOne(input: FunnelInput): FunnelResult {
  const trace: StageTrace[] = [];
  let failedAt: FunnelStageName | null = null;
  let failedReason: string | null = null;

  const stages: Array<() => StageTrace> = [
    () => checkUniverse(input),
    () => checkLiquidity(input),
    () => checkVolatility(input),
    () => checkEarnings(input),
    () => checkWhale(input),
  ];

  for (const stage of stages) {
    const result = stage();
    trace.push(result);
    if (!result.passed && failedAt === null) {
      failedAt = result.stage;
      failedReason = result.reason;
    }
  }

  const composite = checkComposite(input);
  trace.push(composite.trace);
  if (!composite.trace.passed && failedAt === null) {
    failedAt = composite.trace.stage;
    failedReason = composite.trace.reason;
  }

  const stagesPassed = trace.filter((t) => t.passed).length;
  const passed = stagesPassed === FUNNEL_STAGES.length;

  return {
    ticker: input.ticker,
    passed,
    stagesPassed,
    failedAt,
    failedReason,
    trace,
    compositeScore: composite.score,
  };
}

/**
 * Borderline = passed every gate EXCEPT the composite score.
 * The other 5 stages are eligibility gates; only the composite is
 * "soft" — a near-miss there is genuinely worth reviewing, while a
 * near-miss because of small-cap or earnings is a hard reject.
 */
function isBorderline(r: FunnelResult): boolean {
  return !r.passed && r.stagesPassed === FUNNEL_STAGES.length - 1 && r.failedAt === 'composite';
}

export function runFunnel(inputs: FunnelInput[]): FunnelSummary {
  const filteredAt: Record<FunnelStageName, number> = {
    universe: 0,
    liquidity: 0,
    volatility: 0,
    earnings: 0,
    whale: 0,
    composite: 0,
  };

  const results = inputs.map(runFunnelOne);
  for (const r of results) {
    if (r.failedAt) filteredAt[r.failedAt]++;
  }

  const passed = results.filter((r) => r.passed);
  const borderline = results.filter(isBorderline);
  const failed = results.filter((r) => !r.passed && !isBorderline(r));

  const notes: string[] = [];
  if (FEATURES.V5_FUNNEL && passed.length > 5) {
    notes.push(`${passed.length} actionable trades — high; consider tightening thresholds`);
  }
  if (FEATURES.V5_FUNNEL && passed.length === 0 && borderline.length === 0) {
    notes.push('No actionable or borderline trades — funnel may be too tight or input quality too low');
  }

  return { total: inputs.length, passed, borderline, failed, filteredAt, notes };
}
