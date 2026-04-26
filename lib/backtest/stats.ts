// V5 Phase 7 — Backtest stats.
//
// All metrics computed from the closed-trade series and the daily
// equity curve. No external data, pure functions, fully testable.

import type { BacktestStats, BacktestTrade, DailyEquityPoint } from './types';

const TRADING_DAYS_PER_YEAR = 252;

/** Daily returns from an equity curve. Returns 0 for the first day. */
export function dailyReturns(curve: DailyEquityPoint[]): number[] {
  if (curve.length <= 1) return [];
  const out: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1].equity;
    const cur = curve[i].equity;
    out.push(prev === 0 ? 0 : (cur - prev) / prev);
  }
  return out;
}

/** Annualized Sharpe assuming risk-free ≈ 0. Returns 0 on insufficient data. */
export function sharpeRatio(curve: DailyEquityPoint[]): number {
  const rets = dailyReturns(curve);
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/** Largest peak-to-trough drawdown as a fraction. */
export function maxDrawdown(curve: DailyEquityPoint[]): number {
  if (curve.length === 0) return 0;
  let peak = curve[0].equity;
  let maxDD = 0;
  for (const point of curve) {
    if (point.equity > peak) peak = point.equity;
    if (peak > 0) {
      const dd = (point.equity - peak) / peak;
      if (dd < maxDD) maxDD = dd;
    }
  }
  return maxDD;
}

/** Win rate over closed trades. */
export function winRate(trades: BacktestTrade[]): number {
  if (trades.length === 0) return 0;
  const wins = trades.filter((t) => t.finalPnl > 0).length;
  return wins / trades.length;
}

/** avgWin / avgLoss in dollars. Infinity if no losses, 0 if no wins. */
export function profitFactor(trades: BacktestTrade[]): number {
  const wins = trades.filter((t) => t.finalPnl > 0);
  const losses = trades.filter((t) => t.finalPnl < 0);
  if (wins.length === 0) return 0;
  if (losses.length === 0) return Infinity;
  const totalWin = wins.reduce((s, t) => s + t.finalPnl, 0);
  const totalLoss = Math.abs(losses.reduce((s, t) => s + t.finalPnl, 0));
  return totalLoss === 0 ? Infinity : totalWin / totalLoss;
}

/** Expectancy: (winRate × avgWin) − ((1 − winRate) × avgLoss). */
export function expectancy(trades: BacktestTrade[]): number {
  if (trades.length === 0) return 0;
  const wins = trades.filter((t) => t.finalPnl > 0);
  const losses = trades.filter((t) => t.finalPnl < 0);
  const wr = wins.length / trades.length;
  const avgWin = wins.length === 0 ? 0 : wins.reduce((s, t) => s + t.finalPnl, 0) / wins.length;
  const avgLoss = losses.length === 0 ? 0 : Math.abs(losses.reduce((s, t) => s + t.finalPnl, 0) / losses.length);
  return wr * avgWin - (1 - wr) * avgLoss;
}

export function avgDurationDays(trades: BacktestTrade[]): number {
  if (trades.length === 0) return 0;
  return trades.reduce((s, t) => s + t.durationDays, 0) / trades.length;
}

export function totalReturn(curve: DailyEquityPoint[]): number {
  if (curve.length === 0) return 0;
  const start = curve[0].equity;
  const end = curve[curve.length - 1].equity;
  return start === 0 ? 0 : (end - start) / start;
}

export function computeStats(trades: BacktestTrade[], curve: DailyEquityPoint[]): BacktestStats {
  const wins = trades.filter((t) => t.finalPnl > 0).length;
  const losses = trades.filter((t) => t.finalPnl < 0).length;
  return {
    totalTrades: trades.length,
    winners: wins,
    losers: losses,
    winRate: winRate(trades),
    profitFactor: profitFactor(trades),
    expectancy: expectancy(trades),
    totalPnl: trades.reduce((s, t) => s + t.finalPnl, 0),
    sharpe: sharpeRatio(curve),
    maxDrawdown: maxDrawdown(curve),
    totalReturn: totalReturn(curve),
    avgDurationDays: avgDurationDays(trades),
  };
}
