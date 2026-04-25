import type { OptionContract } from '@/lib/data/types';
import type {
  TickerAnalysis,
  Regime,
  TradeTicket,
} from '@/lib/engine/trade-engine';
import type { WhaleAlert } from '@/lib/engine/whale-scanner';
import {
  generateTradeTicket,
  selectBestContract,
  calculatePositionSize,
} from '@/lib/engine/trade-engine';
import {
  classifyMarketCap,
  getNotionalFloor,
  type MarketCapTier,
  type TickerReference,
  type EarningsInfo,
} from '@/lib/data/providers';
import { FEATURES } from '@/lib/config/features';

export type Tier = 'must_try' | 'top_10' | 'scanner' | 'blocked';

// ──────────────────────────────────────────────────────────────────
// V5 Phase 2 — Perfect Setup composite score.
// Weights are calibrated to academic factor significance (Pan-Poteshman
// 2006, Hu 2014, Chordia-Subrahmanyam 2004, Muravyev-Pearson-Pollet 2022).
// Do NOT change weights without ≥ 50 paper trades of evidence.
// ──────────────────────────────────────────────────────────────────

export type PerfectSetupArchetype =
  | 'CONTRARIAN_BULLISH'
  | 'BULLISH_CONVICTION'
  | 'CONTRARIAN_BEARISH'
  | 'BEARISH_CONVICTION';

export type DeltaProfileSignal = 'ACCUMULATING' | 'HEDGING' | 'DISTRIBUTING' | 'NEUTRAL';

export interface PerfectSetupInputs {
  netDeltaZ: number;
  volumeRatio: number;
  persistenceDays: number;
  cumulativeAbnormalOI: number;
  largeContractPremium: number;
  deltaProfile: DeltaProfileSignal;
  ivRank: number;
  momentum12_1: number;
  borrowFeeBps: number;
  rsi14: number;
  vrp: number;
  archetype: PerfectSetupArchetype | null;
}

export const ENTRY_SCORE_THRESHOLD = 70;
export const HIGH_CONVICTION_THRESHOLD = 82;

/** Map whale-scanner flow signal to a Perfect Setup archetype. */
export function mapWhaleSignalToArchetype(
  signal: WhaleAlert['flowSignal'],
): PerfectSetupArchetype | null {
  if (signal === 'CONTRARIAN_BULLISH') return 'CONTRARIAN_BULLISH';
  if (signal === 'CONTRARIAN_BEARISH') return 'CONTRARIAN_BEARISH';
  if (signal === 'BULLISH_CONVICTION' || signal === 'BULLISH_HEDGE') return 'BULLISH_CONVICTION';
  if (signal === 'BEARISH_CONVICTION' || signal === 'BEARISH_HEDGE') return 'BEARISH_CONVICTION';
  return null;
}

function zToPoints(z: number, maxPoints: number): number {
  const absZ = Math.abs(z);
  if (absZ < 1.0) return 0;
  if (absZ < 1.65) return maxPoints * 0.25;
  if (absZ < 2.0) return maxPoints * 0.5;
  if (absZ < 2.33) return maxPoints * 0.75;
  if (absZ < 3.0) return maxPoints * 0.9;
  return maxPoints;
}

function volumeRatioPoints(ratio: number): number {
  if (ratio < 2) return 0;
  if (ratio < 3) return 3;
  if (ratio < 5) return 6;
  if (ratio < 7) return 9;
  if (ratio < 10) return 12;
  if (ratio < 15) return 14;
  return 15;
}

function persistencePoints(days: number, cumOIsigma: number): number {
  let p = 0;
  if (days >= 2) p += 4;
  if (days >= 3) p += 4;
  if (days >= 5) p += 3;
  if (cumOIsigma >= 1.5) p += 4;
  return Math.min(15, p);
}

const PROFILE_BONUS: Record<PerfectSetupArchetype, Partial<Record<DeltaProfileSignal, number>>> = {
  BULLISH_CONVICTION: { ACCUMULATING: 10, NEUTRAL: 3 },
  CONTRARIAN_BULLISH: { HEDGING: 10, NEUTRAL: 3 },
  BEARISH_CONVICTION: { DISTRIBUTING: 10, NEUTRAL: 3 },
  CONTRARIAN_BEARISH: { DISTRIBUTING: 10, NEUTRAL: 3 },
};

export function computePerfectSetupScore(x: PerfectSetupInputs): number {
  let score = 0;

  score += zToPoints(x.netDeltaZ, 25);                      // 25 — informed-flow core
  score += volumeRatioPoints(x.volumeRatio);                // 15 — institutional footprint
  score += persistencePoints(x.persistenceDays, x.cumulativeAbnormalOI); // 15 — accumulation

  // Large-contract premium: log scale past $100K floor, capped at 10
  if (x.largeContractPremium >= 100_000) {
    score += Math.min(10, 2 + 2 * Math.log10(x.largeContractPremium / 100_000));
  }

  // Delta profile — archetype-specific (max 10)
  if (x.archetype) {
    score += PROFILE_BONUS[x.archetype]?.[x.deltaProfile] ?? 0;
  }

  // IV Rank (max 8) — long premium favors cheap vol
  if (x.ivRank < 30) score += 8;
  else if (x.ivRank < 50) score += 5;
  else if (x.ivRank > 80) score -= 3;

  // Momentum 12-1 alignment (max 7)
  const bullish = x.archetype === 'BULLISH_CONVICTION' || x.archetype === 'CONTRARIAN_BULLISH';
  const alignedMomentum = bullish ? x.momentum12_1 : -x.momentum12_1;
  score += Math.max(0, Math.min(7, alignedMomentum * 35));

  // Borrow-fee penalty (max 5; Muravyev-Pearson-Pollet 2022)
  if (x.borrowFeeBps < 50) score += 5;
  else if (x.borrowFeeBps < 200) score += 2;
  else score -= 3;

  // RSI regime (max 3)
  if (x.rsi14 > 30 && x.rsi14 < 70) score += 3;

  // VRP cheap-vol bonus (max 2)
  if (x.vrp < 0.02) score += 2;

  return Math.max(0, Math.min(100, score));
}

export type TradeSide = 'BUY' | 'SELL';
export type TradeStrategy = 'long_call' | 'long_put' | 'short_put' | 'short_call' | 'iron_condor';

export interface MedallionRecommendation {
  side: TradeSide;
  strategy: TradeStrategy;
  contract: string;
  strike: number;
  expiration: string;
  dte: number;
  delta: number;
  contracts: number;
  limitPrice: number;
  estimatedCredit: number;
  maxLoss: number;
  exitRules: TradeTicket['exitRules'];
  expectedPL: TradeTicket['expectedPL'];
  robinhoodSteps: string[];
  reasoning: string[];
}

export interface MedallionGate {
  name: string;
  passed: boolean;
  reason: string;
}

export interface UnifiedScore {
  total: number;
  components: {
    whale: number;
    conviction: number;
    ivEdge: number;
    regime: number;
    liquidity: number;
  };
  tier: Tier;
  gates: MedallionGate[];
  recommendation: MedallionRecommendation | null;
  reasoning: string[];
}

export interface ScoredTicker {
  ticker: string;
  price: number;
  score: UnifiedScore;
  whale: WhaleAlert | null;
  medallion: TickerAnalysis | null;
  reference: TickerReference;
  earnings: EarningsInfo;
}

function scoreWhaleComponent(whale: WhaleAlert | null): number {
  if (!whale) return 0;
  return Math.min(100, Math.round(whale.whaleScore));
}

function scoreConviction(whale: WhaleAlert | null): number {
  if (!whale) return 0;
  const totalVol = whale.callVolume + whale.putVolume;
  if (totalVol < 500) return 0;
  const ratio = Math.abs(whale.netDelta) / totalVol;
  return Math.min(100, Math.round((ratio / 0.5) * 100));
}

function scoreIVEdge(medallion: TickerAnalysis | null): { score: number; mode: 'buy' | 'sell' } {
  if (!medallion) return { score: 0, mode: 'sell' };
  const ivr = medallion.signals.ivRank;
  const vrp = medallion.signals.vrp * 100;
  if (ivr < 50) {
    return { score: Math.round((50 - ivr) * 2), mode: 'buy' };
  }
  const ivrScore = (ivr - 50) * 2;
  const vrpScore = Math.min(Math.max(vrp, 0) / 10, 1) * 100;
  return { score: Math.round(ivrScore * 0.6 + vrpScore * 0.4), mode: 'sell' };
}

function scoreRegimeFit(regime: Regime | undefined): number {
  if (!regime) return 50;
  if (regime.state === 0) return 100;
  if (regime.state === 1) return 60;
  return 30;
}

function scoreLiquidity(whale: WhaleAlert | null, _chain: OptionContract[]): number {
  if (!whale) return 50;
  const oi = whale.totalOI;
  if (oi >= 500_000) return 100;
  if (oi >= 200_000) return 85;
  if (oi >= 100_000) return 70;
  if (oi >= 50_000) return 55;
  if (oi >= 20_000) return 40;
  if (oi >= 5_000) return 25;
  return 10;
}

function buildRobinhoodSteps(rec: MedallionRecommendation, ticker: string): string[] {
  const cp =
    rec.strategy === 'long_call' || rec.strategy === 'short_call' ? 'Call' : 'Put';
  const action = rec.side === 'BUY' ? 'Buy' : 'Sell';
  const expDate = new Date(rec.expiration + 'T00:00:00Z');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtExp = `${months[expDate.getUTCMonth()]} ${expDate.getUTCDate()} '${String(expDate.getUTCFullYear()).slice(2)}`;
  return [
    `Open ${ticker}`,
    'Trade Options',
    action,
    cp,
    fmtExp,
    `$${rec.strike}`,
    `${rec.contracts} contract${rec.contracts === 1 ? '' : 's'}`,
    `Limit $${rec.limitPrice.toFixed(2)}`,
  ];
}

function decideAction(
  whaleScore: number,
  ivr: number,
  vrp: number,
): 'buy' | 'sell' | 'none' {
  if (whaleScore > 75 && ivr < 50) return 'buy';
  if (whaleScore > 50 && ivr > 50 && vrp > 5) return 'sell';
  return 'none';
}

function recommendTrade(
  ticker: string,
  whale: WhaleAlert | null,
  medallion: TickerAnalysis | null,
  chain: OptionContract[],
  portfolioValue: number,
): MedallionRecommendation | null {
  if (!medallion || !whale) return null;
  const ivr = medallion.signals.ivRank;
  const vrp = medallion.signals.vrp * 100;
  const action = decideAction(whale.whaleScore, ivr, vrp);
  if (action === 'none') return null;

  const isBullish = whale.netDelta > 0;

  if (action === 'buy') {
    const contractType: 'call' | 'put' = isBullish ? 'call' : 'put';
    const targetDelta = 0.45;
    const candidates = chain.filter(
      (c) =>
        c.type === contractType &&
        c.dte >= 14 &&
        c.dte <= 60 &&
        c.openInterest > 100 &&
        c.mid > 0 &&
        Math.abs(c.delta) >= 0.25 &&
        Math.abs(c.delta) <= 0.6,
    );
    if (candidates.length === 0) return null;
    candidates.sort(
      (a, b) =>
        Math.abs(Math.abs(a.delta) - targetDelta) -
        Math.abs(Math.abs(b.delta) - targetDelta),
    );
    const c = candidates[0];
    const debit = c.mid;
    const dollarsPerContract = debit * 100;
    const maxRiskFraction = 0.02;
    const maxRiskDollars = portfolioValue * maxRiskFraction;
    const contracts = Math.max(1, Math.floor(maxRiskDollars / dollarsPerContract));
    const limitPrice = Math.round((c.mid + c.ask) / 2 * 100) / 100;
    const expDate = c.expiration.replace(/-/g, '').slice(2);
    const strikePadded = Math.round(c.strike * 1000).toString().padStart(8, '0');
    const occ = `${ticker}${expDate}${contractType === 'call' ? 'C' : 'P'}${strikePadded}`;

    return {
      side: 'BUY',
      strategy: contractType === 'call' ? 'long_call' : 'long_put',
      contract: occ,
      strike: c.strike,
      expiration: c.expiration,
      dte: c.dte,
      delta: c.delta,
      contracts,
      limitPrice,
      estimatedCredit: -limitPrice,
      maxLoss: limitPrice * 100 * contracts,
      exitRules: {
        profitTarget: 1.5,
        profitTargetPrice: Math.round(limitPrice * 1.5 * 100) / 100,
        stopLoss: 0.5,
        stopLossPrice: Math.round(limitPrice * 0.5 * 100) / 100,
        dteCutoff: 21,
        dteCutoffDate: (() => {
          const cutoff = new Date(c.expiration);
          cutoff.setDate(cutoff.getDate() - (c.dte - 21));
          return cutoff.toISOString().slice(0, 10);
        })(),
      },
      expectedPL: {
        maxProfit: Infinity,
        maxLoss: limitPrice * 100 * contracts,
        expectedValue: 0,
        winRate: Math.abs(c.delta),
        breakeven: contractType === 'call' ? c.strike + limitPrice : c.strike - limitPrice,
      },
      robinhoodSteps: [],
      reasoning: [
        `Action BUY (whale ${whale.whaleScore} > 75, IVR ${ivr.toFixed(0)} < 50 — premium is cheap)`,
        `Direction: ${isBullish ? 'bullish' : 'bearish'} (net Δ ${whale.netDelta.toFixed(0)})`,
        `Contract: ${occ} @ $${limitPrice} (Δ ${c.delta.toFixed(3)}, ${c.dte}DTE)`,
        `Sized at 2% portfolio max risk → ${contracts} contract${contracts === 1 ? '' : 's'}`,
      ],
    };
  }

  const sellSide: 'put' | 'call' = isBullish ? 'put' : 'call';
  const sellRegime: Regime = medallion.regime;
  const c = selectBestContract(chain, sellSide, sellRegime);
  if (!c) return null;
  const sizing = calculatePositionSize(c, portfolioValue, sellRegime);
  const ticket = generateTradeTicket(
    ticker,
    c,
    sizing,
    medallion.signals,
    sellRegime,
    medallion.medallionScore,
    sellSide === 'put' ? 'SELL_PUT' : 'SELL_CALL',
  );
  return {
    side: 'SELL',
    strategy: sellSide === 'put' ? 'short_put' : 'short_call',
    contract: ticket.occSymbol,
    strike: ticket.strike,
    expiration: ticket.expiration,
    dte: ticket.dte,
    delta: ticket.delta,
    contracts: ticket.contracts,
    limitPrice: ticket.limitPrice,
    estimatedCredit: ticket.estimatedCredit,
    maxLoss: ticket.maxRisk,
    exitRules: ticket.exitRules,
    expectedPL: ticket.expectedPL,
    robinhoodSteps: [],
    reasoning: [
      `Action SELL (whale ${whale.whaleScore} > 50, IVR ${ivr.toFixed(0)} > 50, VRP ${vrp.toFixed(1)}% > 5%)`,
      `Direction: ${isBullish ? 'bullish' : 'bearish'} → sell ${sellSide}s`,
      ...ticket.reasoning,
    ],
  };
}

export interface ScoreInputs {
  ticker: string;
  whale: WhaleAlert | null;
  medallion: TickerAnalysis | null;
  chain: OptionContract[];
  reference: TickerReference;
  earnings: EarningsInfo;
  portfolioValue: number;
}

function runGates(inputs: ScoreInputs): MedallionGate[] {
  const { whale, medallion, reference, earnings } = inputs;
  const gates: MedallionGate[] = [];

  if (earnings.available && earnings.daysToEarnings !== null) {
    const passed = earnings.daysToEarnings > 7;
    gates.push({
      name: 'earnings',
      passed,
      reason: passed
        ? `Earnings clear (${earnings.daysToEarnings}d away on ${earnings.earningsDate})`
        : `Earnings in ${earnings.daysToEarnings}d on ${earnings.earningsDate} (need >7)`,
    });
  } else if (earnings.available) {
    gates.push({
      name: 'earnings',
      passed: true,
      reason: 'No earnings within 60d',
    });
  } else {
    gates.push({
      name: 'earnings',
      passed: true,
      reason: `Earnings unavailable (${earnings.source})`,
    });
  }

  const tier = reference.tier !== 'unknown' ? reference.tier : classifyMarketCap(reference.marketCap);
  const floor = getNotionalFloor(tier);
  const notional = whale?.totalLargeNotional ?? 0;
  gates.push({
    name: 'notional',
    passed: !whale || notional >= floor,
    reason: !whale
      ? 'Notional gate skipped (no whale data)'
      : notional >= floor
        ? `Notional $${(notional / 1000).toFixed(0)}K ≥ $${floor / 1000}K floor (${tier})`
        : `Notional $${(notional / 1000).toFixed(0)}K < $${floor / 1000}K floor (${tier})`,
  });

  const volRatio = whale?.volumeRatio ?? 0;
  gates.push({
    name: 'unusual',
    passed: volRatio >= 1.5,
    reason: `V/avg ${volRatio.toFixed(1)}× (need ≥ 1.5)`,
  });

  const regime = medallion?.regime;
  const whaleScore = whale?.whaleScore ?? 0;
  const regimeOk = !regime || regime.state !== 2 || whaleScore >= 85;
  gates.push({
    name: 'regime',
    passed: regimeOk,
    reason: !regime
      ? 'Regime unknown'
      : regime.state === 2 && whaleScore < 85
        ? `Crisis regime requires whale ≥ 85 (got ${whaleScore})`
        : `Regime ${regime.label} OK`,
  });

  const liquidity = scoreLiquidity(whale, inputs.chain);
  gates.push({
    name: 'liquidity',
    passed: liquidity >= 25,
    reason: liquidity >= 25
      ? `Liquidity ${liquidity}/100 (OI proxy — no NBBO on plan)`
      : `Total OI too low (${liquidity}/100, OI proxy)`,
  });

  return gates;
}

export function scoreUnified(inputs: ScoreInputs): UnifiedScore {
  const gates = runGates(inputs);
  const allPassed = gates.every((g) => g.passed);

  if (!allPassed) {
    return {
      total: 0,
      components: { whale: 0, conviction: 0, ivEdge: 0, regime: 0, liquidity: 0 },
      tier: 'blocked',
      gates,
      recommendation: null,
      reasoning: gates.filter((g) => !g.passed).map((g) => g.reason),
    };
  }

  const whaleC = scoreWhaleComponent(inputs.whale);
  const convC = scoreConviction(inputs.whale);
  const ivE = scoreIVEdge(inputs.medallion);
  const regimeC = scoreRegimeFit(inputs.medallion?.regime);
  const liqC = scoreLiquidity(inputs.whale, inputs.chain);

  const v4Total = Math.round(
    whaleC * 0.3 + convC * 0.25 + ivE.score * 0.2 + regimeC * 0.15 + liqC * 0.1,
  );

  // V5 Phase 2 — Perfect Setup composite (gated by feature flag).
  let total = v4Total;
  if (FEATURES.V5_SCORING && inputs.whale && inputs.medallion) {
    const archetype = mapWhaleSignalToArchetype(inputs.whale.flowSignal);
    total = computePerfectSetupScore({
      netDeltaZ: inputs.whale.netDeltaZ,
      volumeRatio: inputs.whale.volumeRatio,
      persistenceDays: inputs.whale.persistenceDays,
      cumulativeAbnormalOI: inputs.whale.cumulativeAbnormalOI,
      largeContractPremium: inputs.whale.largeContractPremiumUSD,
      deltaProfile: inputs.whale.deltaProfile.smartMoneySignal,
      ivRank: inputs.medallion.signals.ivRank,
      momentum12_1: inputs.medallion.signals.momentum12_1,
      borrowFeeBps: inputs.whale.borrowFeeBps,
      rsi14: inputs.medallion.signals.rsi,
      vrp: inputs.medallion.signals.vrp,
      archetype,
    });
  }

  // V5 tier thresholds: must_try ≥ HIGH_CONVICTION_THRESHOLD (82),
  // top_10 ≥ ENTRY_SCORE_THRESHOLD (70). Whale gates retained.
  let tier: Tier;
  if (FEATURES.V5_SCORING) {
    if (total >= HIGH_CONVICTION_THRESHOLD && whaleC >= 80) tier = 'must_try';
    else if (total >= ENTRY_SCORE_THRESHOLD && whaleC >= 60) tier = 'top_10';
    else if (total >= 50) tier = 'scanner';
    else tier = 'blocked';
  } else {
    if (total >= 85 && whaleC >= 80) tier = 'must_try';
    else if (total >= 70 && whaleC >= 60) tier = 'top_10';
    else if (total >= 50) tier = 'scanner';
    else tier = 'blocked';
  }

  const rec = recommendTrade(
    inputs.ticker,
    inputs.whale,
    inputs.medallion,
    inputs.chain,
    inputs.portfolioValue,
  );
  if (rec) {
    rec.robinhoodSteps = buildRobinhoodSteps(rec, inputs.ticker);
  }

  const reasoning: string[] = [];
  if (inputs.whale) {
    reasoning.push(
      `Whale ${whaleC}/100 — vol ${inputs.whale.volumeRatio.toFixed(1)}× avg, net Δ ${inputs.whale.netDelta.toFixed(0)}`,
    );
  }
  if (inputs.medallion) {
    reasoning.push(
      `IVR ${inputs.medallion.signals.ivRank.toFixed(0)} (${ivE.mode === 'buy' ? 'cheap → buy bias' : 'rich → sell bias'}), VRP ${(inputs.medallion.signals.vrp * 100).toFixed(1)}%`,
    );
  }
  if (rec) reasoning.push(`Recommended: ${rec.side} ${rec.strategy.replace('_', ' ')}`);

  return {
    total,
    components: { whale: whaleC, conviction: convC, ivEdge: ivE.score, regime: regimeC, liquidity: liqC },
    tier,
    gates,
    recommendation: rec,
    reasoning,
  };
}

export function getTierBadgeOrder(tier: Tier): number {
  return { must_try: 0, top_10: 1, scanner: 2, blocked: 3 }[tier];
}

export type { MarketCapTier };
