import type { OptionContract } from '@/lib/data/types';

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
  const candidates = chain.filter(
    (o) =>
      o.type === type &&
      o.dte >= targetDTE - dteRange &&
      o.dte <= targetDTE + dteRange &&
      Math.abs(o.delta) > 0.05 &&
      Math.abs(o.delta) < 0.5 &&
      o.mid > 0.05 &&
      o.openInterest > 10,
  );
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) => Math.abs(Math.abs(a.delta) - targetDelta) - Math.abs(Math.abs(b.delta) - targetDelta),
  );
  return candidates[0];
}

export function calculatePositionSize(
  c: OptionContract,
  portfolioValue: number,
  regime: Regime,
): { contracts: number; kellyFraction: number; maxRisk: number; buyingPowerRequired: number } {
  const winRate = 1 - Math.abs(c.delta);
  const credit = c.mid;
  const avgWin = credit * 0.5;
  const avgLoss = credit * 2.0;
  const b = avgWin / avgLoss;
  const rawKelly = (winRate * b - (1 - winRate)) / b;
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
