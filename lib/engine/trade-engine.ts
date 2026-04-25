import type { OptionContract } from '@/lib/data/types';
import { FEATURES } from '@/lib/config/features';
import {
  computePositionSizeV5,
  type DrawdownState,
  type StreakState,
} from '@/lib/engine/portfolio';

export interface Signals {
  zscore: number;
  zscoreLookback: number;
  rsi: number;
  iv: number;
  rv: number;
  vrp: number;
  ivRank: number;
  momentum12_1: number;
}

export interface Regime {
  state: 0 | 1 | 2;
  label: 'LOW VOL' | 'HIGH VOL' | 'CRISIS';
  targetDelta: number;
  targetDTE: number;
  sizeMultiplier: number;
}

export interface GateResult {
  pass: boolean;
  reasons: string[];
  blocks: string[];
}

export interface Gates {
  putEntry: GateResult;
  callEntry: GateResult;
  icEntry: GateResult;
}

export interface TradeTicket {
  id: string;
  type: 'SELL_PUT' | 'SELL_CALL' | 'IRON_CONDOR';
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  underlying: string;
  occSymbol: string;
  strike: number;
  strikeCall?: number;
  expiration: string;
  dte: number;
  delta: number;
  bid: number;
  ask: number;
  mid: number;
  limitPrice: number;
  estimatedCredit: number;
  contracts: number;
  kellyFraction: number;
  maxRisk: number;
  buyingPowerRequired: number;
  exitRules: {
    profitTarget: number;
    profitTargetPrice: number;
    stopLoss: number;
    stopLossPrice: number;
    dteCutoff: number;
    dteCutoffDate: string;
  };
  expectedPL: {
    maxProfit: number;
    maxLoss: number;
    expectedValue: number;
    winRate: number;
    breakeven: number;
  };
  reasoning: string[];
  /** V5 Phase 3: present only when FEATURES.V5_CONTRACT_RULES is on. */
  scaleInPlan?: ScaleInPlan;
}

export interface TickerAnalysis {
  ticker: string;
  price: number;
  timestamp: string;
  signals: Signals;
  regime: Regime;
  medallionScore: number;
  stockSignal: string;
  gates: Gates;
  trades: TradeTicket[];
  notes: string[];
}

export function computeSignals(prices: number[], chain: OptionContract[]): Signals {
  const lookback = 15;
  const window = prices.slice(-lookback);
  const mean = window.reduce((a, b) => a + b, 0) / lookback;
  const std = Math.sqrt(window.reduce((a, b) => a + (b - mean) ** 2, 0) / lookback);
  const zscore = std > 0 ? (prices[prices.length - 1] - mean) / std : 0;

  let gains = 0;
  let losses = 0;
  for (let i = prices.length - 14; i < prices.length; i++) {
    const ch = prices[i] - prices[i - 1];
    if (ch > 0) gains += ch;
    else losses -= ch;
  }
  gains /= 14;
  losses /= 14;
  const rsi = losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);

  const rets: number[] = [];
  for (let i = prices.length - 20; i < prices.length; i++) {
    rets.push(Math.log(prices[i] / prices[i - 1]));
  }
  const retMean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const rv = Math.sqrt(
    (rets.reduce((a, b) => a + (b - retMean) ** 2, 0) / (rets.length - 1)) * 252,
  );

  const currentPrice = prices[prices.length - 1];
  const atm = chain.filter(
    (o) => Math.abs(o.strike - currentPrice) / currentPrice < 0.05 && o.dte >= 21 && o.dte <= 60,
  );
  const iv =
    atm.length > 0 ? atm.reduce((a, o) => a + o.iv, 0) / atm.length : rv * 1.15;

  const vrp = iv - rv;

  const ivHistory: number[] = [];
  for (let i = 60; i < prices.length; i += 5) {
    const subRets: number[] = [];
    for (let j = i - 20; j < i; j++) subRets.push(Math.log(prices[j] / prices[j - 1]));
    const m = subRets.reduce((a, b) => a + b, 0) / subRets.length;
    const sr = Math.sqrt(
      (subRets.reduce((a, b) => a + (b - m) ** 2, 0) / (subRets.length - 1)) * 252,
    );
    ivHistory.push(sr * 1.15);
  }
  const sorted = [...ivHistory].sort((a, b) => a - b);
  const ivRank =
    sorted.length > 0 ? (sorted.filter((v) => v <= iv).length / sorted.length) * 100 : 50;

  const momentum12_1 =
    prices.length >= 252
      ? (prices[prices.length - 1] - prices[prices.length - 252]) / prices[prices.length - 252] -
        (prices[prices.length - 1] - prices[prices.length - 21]) / prices[prices.length - 21]
      : 0;

  return { zscore, zscoreLookback: lookback, rsi, iv, rv, vrp, ivRank, momentum12_1 };
}

export function detectRegime(prices: number[], vixLevel?: number): Regime {
  const rets20: number[] = [];
  for (let i = prices.length - 20; i < prices.length; i++) {
    rets20.push(Math.log(prices[i] / prices[i - 1]));
  }
  const m20 = rets20.reduce((a, b) => a + b, 0) / 20;
  const rv20 = Math.sqrt((rets20.reduce((a, b) => a + (b - m20) ** 2, 0) / 19) * 252);

  const rets5: number[] = [];
  for (let i = prices.length - 5; i < prices.length; i++) {
    rets5.push(Math.log(prices[i] / prices[i - 1]));
  }
  const m5 = rets5.reduce((a, b) => a + b, 0) / 5;
  const rv5 = Math.sqrt((rets5.reduce((a, b) => a + (b - m5) ** 2, 0) / 4) * 252);

  const ratio = rv5 / (rv20 + 1e-10);
  const vix = vixLevel ?? rv20 * 100;

  let peak = prices[prices.length - 20];
  let maxDD = 0;
  for (let i = prices.length - 20; i < prices.length; i++) {
    if (prices[i] > peak) peak = prices[i];
    const dd = (prices[i] - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }

  const crisis =
    (rv20 > 0.3 ? 2 : rv20 > 0.25 ? 1 : 0) +
    (ratio > 2.0 ? 2 : ratio > 1.5 ? 1 : 0) +
    (vix > 30 ? 2 : vix > 25 ? 1 : 0) +
    (maxDD < -0.05 ? 2 : maxDD < -0.03 ? 1 : 0);

  const calm =
    (rv20 < 0.12 ? 2 : rv20 < 0.15 ? 1 : 0) +
    (ratio < 1.2 ? 2 : ratio < 1.3 ? 1 : 0) +
    (vix < 15 ? 2 : vix < 18 ? 1 : 0);

  if (crisis >= 5) {
    return { state: 2, label: 'CRISIS', targetDelta: 0.1, targetDTE: 21, sizeMultiplier: 0.25 };
  }
  if (calm >= 4) {
    return { state: 0, label: 'LOW VOL', targetDelta: 0.3, targetDTE: 45, sizeMultiplier: 1.0 };
  }
  return { state: 1, label: 'HIGH VOL', targetDelta: 0.16, targetDTE: 30, sizeMultiplier: 0.75 };
}

export function computeMedallionScore(
  s: Signals,
  regime: Regime,
): { score: number; signal: string } {
  const mrS =
    s.zscore < -1.5 ? 95 : s.zscore < -1 ? 75 : s.zscore < -0.5 ? 55 : s.zscore > 1.5 ? 10 : s.zscore > 1 ? 25 : 35;
  const rsiS =
    s.rsi < 25 ? 95 : s.rsi < 30 ? 82 : s.rsi < 40 ? 60 : s.rsi > 70 ? 12 : s.rsi > 60 ? 30 : 40;
  const vrpS =
    s.vrp > 0.15 ? 95 : s.vrp > 0.1 ? 82 : s.vrp > 0.05 ? 65 : s.vrp > 0 ? 40 : 12;
  const ivrS =
    s.ivRank > 80 ? 92 : s.ivRank > 60 ? 75 : s.ivRank > 50 ? 60 : s.ivRank > 40 ? 45 : 28;
  const momS =
    s.momentum12_1 > 0.3
      ? 90
      : s.momentum12_1 > 0.2
        ? 75
        : s.momentum12_1 > 0.1
          ? 60
          : s.momentum12_1 > 0
            ? 50
            : s.momentum12_1 > -0.1
              ? 40
              : s.momentum12_1 > -0.2
                ? 25
                : 10;

  let w: { mr: number; rsi: number; vrp: number; ivr: number; mom: number };
  if (regime.state === 0) {
    w = { mr: 0.2, rsi: 0.15, vrp: 0.2, ivr: 0.15, mom: 0.3 };
  } else if (regime.state === 2) {
    w = { mr: 0.35, rsi: 0.25, vrp: 0.2, ivr: 0.1, mom: 0.1 };
  } else {
    w = { mr: 0.25, rsi: 0.2, vrp: 0.2, ivr: 0.15, mom: 0.2 };
  }

  if (Math.abs(s.zscore) > 0.8) {
    w.mr += w.mom * 0.5;
    w.rsi += w.mom * 0.5;
    w.mom = 0;
  }

  const regMul = [1.1, 0.85, 0.4][regime.state];
  const raw =
    (mrS * w.mr + rsiS * w.rsi + vrpS * w.vrp + ivrS * w.ivr + momS * w.mom) * regMul;
  const score = Math.min(100, Math.max(0, Math.round(raw)));
  const signal =
    score >= 78 ? 'STRONG BUY' : score >= 62 ? 'BUY' : score >= 40 ? 'HOLD' : score >= 22 ? 'AVOID' : 'STRONG AVOID';

  return { score, signal };
}

export function evaluateGates(s: Signals, regime: Regime, score: number): Gates {
  const putReasons: string[] = [];
  const putBlocks: string[] = [];
  if (s.vrp > 0.05) putReasons.push(`VRP ${(s.vrp * 100).toFixed(1)}% > 5%`);
  else putBlocks.push(`VRP ${(s.vrp * 100).toFixed(1)}% < 5%`);
  if (s.ivRank > 50) putReasons.push(`IV Rank ${s.ivRank.toFixed(0)}% > 50%`);
  else putBlocks.push(`IV Rank ${s.ivRank.toFixed(0)}% < 50%`);
  if (s.zscore < 0.5) putReasons.push(`Z-score ${s.zscore.toFixed(2)} — not overbought`);
  else putBlocks.push(`Z-score ${s.zscore.toFixed(2)} — overbought`);
  if (regime.state !== 2) putReasons.push(`Regime ${regime.label}`);
  else if (s.vrp > 0.12) putReasons.push(`Crisis but VRP very fat`);
  else putBlocks.push(`Crisis + VRP thin`);
  if (score >= 40) putReasons.push(`Score ${score} ≥ 40`);
  else putBlocks.push(`Score ${score} < 40`);
  const putPass = putBlocks.length === 0;

  const callReasons: string[] = [];
  const callBlocks: string[] = [];
  if (s.zscore > 0.3) callReasons.push(`Z-score ${s.zscore.toFixed(2)} — overbought bias`);
  else callBlocks.push(`Z-score ${s.zscore.toFixed(2)} — not overbought`);
  if (s.ivRank > 40) callReasons.push(`IV Rank ${s.ivRank.toFixed(0)}% > 40%`);
  else callBlocks.push(`IV Rank ${s.ivRank.toFixed(0)}% < 40%`);
  if (s.vrp > 0.03) callReasons.push(`VRP ${(s.vrp * 100).toFixed(1)}% > 3%`);
  else callBlocks.push(`VRP ${(s.vrp * 100).toFixed(1)}% < 3%`);
  if (score >= 40) callReasons.push(`Score ${score} ≥ 40`);
  else callBlocks.push(`Score ${score} < 40`);
  const callPass = callBlocks.length === 0;

  const icReasons: string[] = [];
  const icBlocks: string[] = [];
  if (Math.abs(s.zscore) < 0.8) icReasons.push(`|Z| ${Math.abs(s.zscore).toFixed(2)} < 0.8 — range-bound`);
  else icBlocks.push(`|Z| ${Math.abs(s.zscore).toFixed(2)} — too directional`);
  if (s.vrp > 0.05) icReasons.push(`VRP ${(s.vrp * 100).toFixed(1)}% > 5%`);
  else icBlocks.push(`VRP too thin`);
  if (s.ivRank > 55) icReasons.push(`IV Rank ${s.ivRank.toFixed(0)}% > 55%`);
  else icBlocks.push(`IV Rank too low`);
  if (regime.state === 2) icBlocks.push(`Crisis — no ICs`);
  const icPass = icBlocks.length === 0;

  return {
    putEntry: { pass: putPass, reasons: putReasons, blocks: putBlocks },
    callEntry: { pass: callPass, reasons: callReasons, blocks: callBlocks },
    icEntry: { pass: icPass, reasons: icReasons, blocks: icBlocks },
  };
}

export function selectBestContract(
  chain: OptionContract[],
  type: 'put' | 'call',
  regime: Regime,
): OptionContract | null {
  const { targetDelta, targetDTE } = regime;
  const dteRange = 12;
  const dteCutoffBuffer = 26;
  const candidates = chain.filter(
    (o) =>
      o.type === type &&
      o.dte >= Math.max(targetDTE - dteRange, dteCutoffBuffer) &&
      o.dte <= targetDTE + dteRange &&
      Math.abs(o.delta) > 0.05 &&
      Math.abs(o.delta) < 0.5 &&
      o.mid > 0.05 &&
      o.openInterest > 100,
  );
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) => Math.abs(Math.abs(a.delta) - targetDelta) - Math.abs(Math.abs(b.delta) - targetDelta),
  );
  return candidates[0];
}

export interface V5SizingContext {
  streak: StreakState;
  drawdown: DrawdownState;
}

export function calculatePositionSize(
  c: OptionContract,
  portfolioValue: number,
  regime: Regime,
  v5Context?: V5SizingContext,
): { contracts: number; kellyFraction: number; maxRisk: number; buyingPowerRequired: number; halt?: boolean } {
  const winRate = 1 - Math.abs(c.delta);
  const credit = c.mid;
  const avgWin = credit * 0.5;
  const avgLoss = credit * 2.0;
  const winLossRatio = avgWin / avgLoss;

  // V5 Phase 5 — half-Kelly + streak survival + DD circuit breaker.
  // Falls through to V4 quarter-Kelly when flag is off or context missing.
  if (FEATURES.V5_PORTFOLIO && v5Context) {
    const out = computePositionSizeV5({
      winRate,
      winLossRatio,
      regimeMultiplier: regime.sizeMultiplier,
      streak: v5Context.streak,
      drawdown: v5Context.drawdown,
    });
    if (out.halt) {
      return { contracts: 0, kellyFraction: 0, maxRisk: 0, buyingPowerRequired: 0, halt: true };
    }
    const maxRiskDollarsV5 = portfolioValue * out.kellyFraction;
    const bpPerContractV5 = c.strike * 100;
    const contractsV5 = Math.max(1, Math.floor(maxRiskDollarsV5 / (credit * 2 * 100)));
    return {
      contracts: contractsV5,
      kellyFraction: out.kellyFraction,
      maxRisk: contractsV5 * credit * 2 * 100,
      buyingPowerRequired: contractsV5 * bpPerContractV5,
    };
  }

  // V4 quarter-Kelly path (default).
  const rawKelly = (winRate * winLossRatio - (1 - winRate)) / winLossRatio;
  const kellyFraction = Math.max(0, Math.min(rawKelly * 0.25 * regime.sizeMultiplier, 0.05));
  const maxRiskDollars = portfolioValue * kellyFraction;
  const bpPerContract = c.strike * 100;
  const contracts = Math.max(1, Math.floor(maxRiskDollars / (credit * 2 * 100)));
  return {
    contracts,
    kellyFraction,
    maxRisk: contracts * credit * 2 * 100,
    buyingPowerRequired: contracts * bpPerContract,
  };
}

export function generateTradeTicket(
  ticker: string,
  c: OptionContract,
  sizing: ReturnType<typeof calculatePositionSize>,
  s: Signals,
  regime: Regime,
  score: number,
  type: 'SELL_PUT' | 'SELL_CALL' | 'IRON_CONDOR',
): TradeTicket {
  const credit = c.mid;
  const expDate = c.expiration.replace(/-/g, '').slice(2);
  const cp = c.type === 'call' ? 'C' : 'P';
  const strikePadded = Math.round(c.strike * 1000).toString().padStart(8, '0');
  const occSymbol = `${ticker}${expDate}${cp}${strikePadded}`;

  const limitPrice = Math.round(((c.bid + credit) / 2) * 100) / 100;
  const profitTargetPrice = Math.round(credit * 0.5 * 100) / 100;
  const stopLossPrice = Math.round(credit * 2.0 * 100) / 100;
  const dteCutoff = 21;
  const cutoff = new Date(c.expiration);
  cutoff.setDate(cutoff.getDate() - (c.dte - dteCutoff));

  const winRate = 1 - Math.abs(c.delta);
  const maxProfit = credit * 100 * sizing.contracts;
  const maxLoss = credit * 2 * 100 * sizing.contracts;
  const expectedValue =
    (winRate * (credit * 0.5 * 100) - (1 - winRate) * (credit * 2 * 100)) * sizing.contracts;
  const breakeven = c.type === 'put' ? c.strike - credit : c.strike + credit;
  const urgency: 'HIGH' | 'MEDIUM' | 'LOW' =
    score >= 78 && s.vrp > 0.1 ? 'HIGH' : score >= 62 && s.vrp > 0.05 ? 'MEDIUM' : 'LOW';

  const reasoning = [
    `Medallion Score: ${score}/100`,
    `Regime: ${regime.label} → Target Δ=${regime.targetDelta}, DTE=${regime.targetDTE}`,
    `VRP: ${(s.vrp * 100).toFixed(1)}% (IV ${(s.iv * 100).toFixed(1)}% - RV ${(s.rv * 100).toFixed(1)}%)`,
    `IV Rank: ${s.ivRank.toFixed(0)}%`,
    `Z-Score: ${s.zscore.toFixed(2)}, RSI: ${s.rsi.toFixed(0)}`,
    `Selected: ${occSymbol} @ $${limitPrice} (Δ=${c.delta.toFixed(3)}, ${c.dte}DTE)`,
    `Kelly: ${(sizing.kellyFraction * 100).toFixed(2)}% → ${sizing.contracts} contract(s)`,
    `Exit: close @ $${profitTargetPrice} (50% profit) OR $${stopLossPrice} (2× loss) OR ${dteCutoff}DTE`,
  ];

  return {
    id: `${ticker}-${type}-${Date.now()}`,
    type,
    urgency,
    underlying: ticker,
    occSymbol,
    strike: c.strike,
    expiration: c.expiration,
    dte: c.dte,
    delta: c.delta,
    bid: c.bid,
    ask: c.ask,
    mid: credit,
    limitPrice,
    estimatedCredit: credit,
    contracts: sizing.contracts,
    kellyFraction: sizing.kellyFraction,
    maxRisk: sizing.maxRisk,
    buyingPowerRequired: sizing.buyingPowerRequired,
    exitRules: {
      profitTarget: 0.5,
      profitTargetPrice,
      stopLoss: 2.0,
      stopLossPrice,
      dteCutoff,
      dteCutoffDate: cutoff.toISOString().slice(0, 10),
    },
    expectedPL: { maxProfit, maxLoss, expectedValue, winRate, breakeven },
    reasoning,
    // V5 Phase 3 — every V5 ticket carries a scaleInPlan; legacy stays undefined.
    ...(FEATURES.V5_CONTRACT_RULES ? { scaleInPlan: DEFAULT_SCALE_IN_PLAN } : {}),
  };
}

export function analyzeTicker(
  ticker: string,
  currentPrice: number,
  prices: number[],
  chain: OptionContract[],
  portfolioValue: number,
  vixLevel?: number,
): TickerAnalysis {
  const notes: string[] = [];
  if (prices.length < 252) notes.push(`Only ${prices.length} daily bars — momentum12_1 disabled`);
  if (chain.length === 0) notes.push('No options chain returned');

  const signals = computeSignals(prices, chain);
  const regime = detectRegime(prices, vixLevel);

  const adaptive = regime.state === 2 ? 10 : regime.state === 1 ? 15 : 20;
  const win = prices.slice(-adaptive);
  const mean = win.reduce((a, b) => a + b, 0) / adaptive;
  const std = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / adaptive);
  signals.zscore = std > 0 ? (currentPrice - mean) / std : 0;
  signals.zscoreLookback = adaptive;

  const { score, signal } = computeMedallionScore(signals, regime);
  const gates = evaluateGates(signals, regime, score);
  const trades: TradeTicket[] = [];

  if (gates.putEntry.pass) {
    const c = selectBestContract(chain, 'put', regime);
    if (c) {
      const sizing = calculatePositionSize(c, portfolioValue, regime);
      trades.push(generateTradeTicket(ticker, c, sizing, signals, regime, score, 'SELL_PUT'));
    } else {
      notes.push('Put gate passed but no suitable contract found in chain');
    }
  }
  if (gates.callEntry.pass) {
    const c = selectBestContract(chain, 'call', regime);
    if (c) {
      const sizing = calculatePositionSize(c, portfolioValue, regime);
      trades.push(generateTradeTicket(ticker, c, sizing, signals, regime, score, 'SELL_CALL'));
    }
  }

  return {
    ticker,
    price: currentPrice,
    timestamp: new Date().toISOString(),
    signals,
    regime,
    medallionScore: score,
    stockSignal: signal,
    gates,
    trades,
    notes,
  };
}

// ──────────────────────────────────────────────────────────────────
// V5 Phase 3 — Archetype-specific contract selection.
//
// Squeeze setups (CONTRARIAN_BULLISH/BEARISH) stay closer to ATM because
// dealer-hedge flow concentrates near high-OI strikes and squeezes
// resolve in 3–10 days. Trend setups (BULLISH/BEARISH_CONVICTION) can
// stretch further OTM because the time horizon supports it.
//
// Three-strike ladder (55/30/15 or 50/30/20) balances inner-strike
// anchor (finances on moderate moves) against outer-strike tail
// (captures the rare 5–10× winner).
// ──────────────────────────────────────────────────────────────────

export type V5Archetype =
  | 'CONTRARIAN_BULLISH'
  | 'BULLISH_CONVICTION'
  | 'CONTRARIAN_BEARISH'
  | 'BEARISH_CONVICTION';

export interface ArchetypeContractRules {
  deltaTarget: number;
  deltaRange: [number, number];
  dteTarget: number;
  dteRange: [number, number];
  strikeOffsetPct: number;
  ladderWeights: [number, number, number];
  ladderOffsets: [number, number, number];
}

export const CONTRACT_RULES: Record<V5Archetype, ArchetypeContractRules> = {
  CONTRARIAN_BULLISH: {
    deltaTarget: 0.35,
    deltaRange: [0.28, 0.45],
    dteTarget: 28,
    dteRange: [21, 35],
    strikeOffsetPct: 0.05,
    ladderWeights: [0.55, 0.3, 0.15],
    ladderOffsets: [0.03, 0.07, 0.12],
  },
  BULLISH_CONVICTION: {
    deltaTarget: 0.3,
    deltaRange: [0.22, 0.4],
    dteTarget: 35,
    dteRange: [28, 50],
    strikeOffsetPct: 0.08,
    ladderWeights: [0.5, 0.3, 0.2],
    ladderOffsets: [0.05, 0.1, 0.15],
  },
  CONTRARIAN_BEARISH: {
    deltaTarget: -0.35,
    deltaRange: [-0.45, -0.28],
    dteTarget: 28,
    dteRange: [21, 35],
    strikeOffsetPct: -0.04,
    ladderWeights: [0.6, 0.25, 0.15],
    ladderOffsets: [-0.03, -0.06, -0.1],
  },
  BEARISH_CONVICTION: {
    deltaTarget: -0.3,
    deltaRange: [-0.4, -0.22],
    dteTarget: 35,
    dteRange: [28, 50],
    strikeOffsetPct: -0.07,
    ladderWeights: [0.5, 0.3, 0.2],
    ladderOffsets: [-0.05, -0.09, -0.14],
  },
};

/**
 * Liquidity gate. Rejects uninvestable contracts.
 *
 * Note on spread: the brief specifies spread ≤ 10% of mid via
 * `last_quote.bid/ask`. Polygon Developer ($79) does NOT include
 * NBBO quotes — that requires Advanced ($199). Our OptionContract.bid
 * and ask are synthesized from `day.close ± 4%`, producing a constant
 * 8% spread that always passes the 10% check. Until we add Advanced
 * tier or Tradier, the spread component is effectively a no-op; OI
 * and volume floors do the real liquidity work.
 */
export function passesLiquidityGate(c: OptionContract): boolean {
  if (c.openInterest < 500) return false;
  if (c.volume < 100) return false;
  const mid = c.mid;
  if (mid <= 0) return false;
  if (c.bid <= 0 || c.ask <= 0) return false;
  const spreadPct = (c.ask - c.bid) / mid;
  return spreadPct <= 0.1;
}

export interface ContractOrder {
  contract: OptionContract;
  qty: number;
  limitPrice: number;
  ladderSlot: 0 | 1 | 2;
  slotBudget: number;
}

function v5DaysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

function nearestByStrike(candidates: OptionContract[], targetStrike: number): OptionContract {
  return candidates.reduce((a, b) =>
    Math.abs(b.strike - targetStrike) < Math.abs(a.strike - targetStrike) ? b : a,
  );
}

function v5LimitPrice(c: OptionContract): number {
  const spread = c.ask - c.bid;
  // Pay slightly above mid to improve fill probability without crossing the spread.
  return Math.round((c.mid + spread * 0.25) * 100) / 100;
}

/**
 * Select a 3-strike ladder for the given archetype, or a single inner-strike
 * contract if budget < $1500. Returns [] if no candidates pass filters.
 */
export function selectContract(
  archetype: V5Archetype,
  chain: OptionContract[],
  spot: number,
  budget: number,
): ContractOrder[] {
  const rules = CONTRACT_RULES[archetype];
  const isCall = archetype.includes('BULLISH');
  const targetType: OptionContract['type'] = isCall ? 'call' : 'put';

  const candidates = chain
    .filter((c) => c.type === targetType)
    .filter((c) => c.dte >= rules.dteRange[0] && c.dte <= rules.dteRange[1])
    .filter((c) => c.delta >= rules.deltaRange[0] && c.delta <= rules.deltaRange[1])
    .filter(passesLiquidityGate);

  if (candidates.length === 0) {
    console.warn(`[selectContract] no candidates for ${archetype} (chain=${chain.length}, spot=${spot})`);
    return [];
  }

  // Small budget: single inner-strike contract (no ladder).
  if (budget < 1500) {
    const targetStrike = spot * (1 + rules.ladderOffsets[0]);
    const best = nearestByStrike(candidates, targetStrike);
    const limitPrice = v5LimitPrice(best);
    const qty = Math.max(1, Math.floor(budget / (best.ask * 100)));
    return [{ contract: best, qty, limitPrice, ladderSlot: 0, slotBudget: budget }];
  }

  const orders: ContractOrder[] = [];
  for (let i = 0 as 0 | 1 | 2; i < 3; i = (i + 1) as 0 | 1 | 2) {
    const targetStrike = spot * (1 + rules.ladderOffsets[i]);
    const best = nearestByStrike(candidates, targetStrike);
    const slotBudget = budget * rules.ladderWeights[i];
    const qty = Math.max(1, Math.floor(slotBudget / (best.ask * 100)));
    const limitPrice = v5LimitPrice(best);
    orders.push({ contract: best, qty, limitPrice, ladderSlot: i, slotBudget });
  }
  return orders;
}

/** Days-between helper exposed for tests. */
export const _v5DaysBetween = v5DaysBetween;

// ──────────────────────────────────────────────────────────────────
// V5 Phase 3 — Scale-in convention.
//
// Initial 70% on signal bar. Reserve 30% deployed within 3 days only
// if pullback ≤ 2% and signal still active. Reserve cancels on flow
// reversal. Phase 4's exit-engine will own the daily monitoring loop.
// ──────────────────────────────────────────────────────────────────

export interface ScaleInPlan {
  initialDeploymentPct: 0.7;
  reserveDeploymentPct: 0.3;
  reserveWindow: { days: 3; maxPullbackPct: 0.02 };
  reserveCancellationTrigger: 'flow_reversal';
}

export const DEFAULT_SCALE_IN_PLAN: ScaleInPlan = {
  initialDeploymentPct: 0.7,
  reserveDeploymentPct: 0.3,
  reserveWindow: { days: 3, maxPullbackPct: 0.02 },
  reserveCancellationTrigger: 'flow_reversal',
};
