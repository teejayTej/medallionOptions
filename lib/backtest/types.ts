// V5 Phase 7 — Backtest harness types.
//
// The harness consumes historical inputs (built from Phase 1's
// getOptionTrades + getContractsIncludingExpired or supplied as
// fixtures) and simulates the full V5 entry/exit pipeline:
//
//   signal day  → archetype detected → contract selected
//                                   ↓
//                           daily forward walk
//                                   ↓
//                         exit-engine evaluation
//                                   ↓
//                     trade closed with outcome P&L
//
// All metrics (Sharpe, max DD, profit factor, win rate, expectancy)
// are computed on the closed-trade series.

import type { Archetype } from '@/lib/engine/exit-engine';

export interface BacktestSpec {
  /** ISO date inclusive. */
  startDate: string;
  endDate: string;
  /** Tickers to include in the universe walk. */
  universe: string[];
  /** Starting account size. */
  startingCapital: number;
  /** Strategy override; empty uses default V5 strategy. */
  strategyName?: string;
}

export interface DailyChainSnapshot {
  date: string;
  ticker: string;
  underlyingPrice: number;
  /** Per-contract daily aggregates filtered to the candidate window. */
  contracts: Array<{
    occSymbol: string;
    type: 'call' | 'put';
    strike: number;
    expiration: string;
    dte: number;
    /** Estimated end-of-day mid (Polygon Developer doesn't include NBBO). */
    midPrice: number;
    /** Synthetic from mid for the harness; real bid/ask requires Advanced. */
    bid: number;
    ask: number;
    /** Black-Scholes-derived if not supplied; empirically required. */
    delta: number;
    gamma: number;
    theta: number;
    iv: number;
    openInterest: number;
    volume: number;
  }>;
  /** Pre-computed signal inputs for that day (whale + Medallion equivalent). */
  signal: SignalSnapshot | null;
}

export interface SignalSnapshot {
  archetype: Archetype | null;
  whaleScore: number;
  perfectSetupScore: number;
  /** True when this day satisfies V5_SCORING entry threshold (≥70). */
  isEntryCandidate: boolean;
}

export interface BacktestTrade {
  id: string;
  ticker: string;
  archetype: Archetype;
  entryDate: string;
  entryPrice: number;
  qty: number;
  contractSymbol: string;
  strike: number;
  expiration: string;
  exits: Array<{
    date: string;
    qty: number;
    price: number;
    reason: string;
  }>;
  finalPnl: number;
  finalPnlPct: number;
  durationDays: number;
  closedReason: string;
}

export interface DailyEquityPoint {
  date: string;
  /** Sum of realized P&L through this day plus mark-to-market on open trades. */
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  openTradeCount: number;
}

export interface BacktestStats {
  /** Total closed trades. */
  totalTrades: number;
  winners: number;
  losers: number;
  winRate: number;
  /** avgWin / avgLoss in dollars. */
  profitFactor: number;
  expectancy: number;
  totalPnl: number;
  /** Annualized Sharpe assuming 252 trading days. */
  sharpe: number;
  /** Largest peak-to-trough drawdown over the equity curve, as a fraction. */
  maxDrawdown: number;
  /** Final equity / starting equity - 1. */
  totalReturn: number;
  /** Average trade duration in days. */
  avgDurationDays: number;
}

export interface BacktestRun {
  spec: BacktestSpec;
  trades: BacktestTrade[];
  equityCurve: DailyEquityPoint[];
  stats: BacktestStats;
  /** Tickers / dates that errored, didn't have inputs, etc. */
  diagnostics: string[];
  /** Real wall-clock duration of the backtest. */
  walltimeMs: number;
}
