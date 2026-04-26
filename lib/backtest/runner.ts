// V5 Phase 7 — Backtest runner.
//
// Orchestrates: walk daily inputs → detect entry signals → simulate
// contract selection → forward-walk through subsequent days → call
// exit-engine each day → close position when CLOSE fires → record
// trade with full P&L log.
//
// The harness is data-source agnostic: it accepts a DataProvider
// interface that supplies DailyChainSnapshot per (date, ticker).
// Real Polygon-backed providers and in-memory fixture providers
// both satisfy it.
//
// Greeks computation is the caller's responsibility. Polygon historical
// aggregates don't include Greeks; a real provider must compute them
// (Black-Scholes given strike/expiry/spot/IV/rate) before calling
// runBacktest. The fixture provider in tests supplies them directly.

import { evaluateExit, type ExitAction, type Position, type ReversalSignals } from '@/lib/engine/exit-engine';
import { computeStats } from './stats';
import type {
  BacktestRun,
  BacktestSpec,
  BacktestTrade,
  DailyChainSnapshot,
  DailyEquityPoint,
} from './types';
import type { OptionContract } from '@/lib/data/types';

const NO_REVERSAL: ReversalSignals = {
  netDeltaFlipped2Days: false,
  oiDropVolElevated: false,
  ivFallingWhileUnderlyingUp: false,
  contrarianBearishFiring: false,
};

export interface DataProvider {
  /** Return all trading dates (ISO) inclusive between start and end. */
  tradingDates(start: string, end: string): string[];
  /** Snapshot for a given ticker on a given date, or null if not available. */
  snapshot(date: string, ticker: string): DailyChainSnapshot | null;
}

interface OpenTradeState {
  trade: BacktestTrade;
  position: Position;
  /** Snapshot of underlying peak for trail/pullback maths. */
  peakUnderlying: number;
}

function snapshotToContract(c: DailyChainSnapshot['contracts'][0], underlying: string): OptionContract {
  return {
    ticker: c.occSymbol,
    underlying,
    type: c.type,
    strike: c.strike,
    expiration: c.expiration,
    dte: c.dte,
    delta: c.delta,
    gamma: c.gamma,
    theta: c.theta,
    vega: 0,
    iv: c.iv,
    impliedVolatility: c.iv,
    openInterest: c.openInterest,
    volume: c.volume,
    bid: c.bid,
    ask: c.ask,
    mid: c.midPrice,
    lastPrice: c.midPrice,
  };
}

/** Pick the contract closest to target delta from the snapshot. */
function pickEntryContract(
  snap: DailyChainSnapshot,
  isBullish: boolean,
  targetDelta: number,
  dteRange: [number, number],
): DailyChainSnapshot['contracts'][0] | null {
  const wantType: 'call' | 'put' = isBullish ? 'call' : 'put';
  const candidates = snap.contracts
    .filter((c) => c.type === wantType)
    .filter((c) => c.dte >= dteRange[0] && c.dte <= dteRange[1])
    .filter((c) => c.openInterest >= 100 && c.volume >= 50);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) =>
    Math.abs(Math.abs(b.delta) - targetDelta) < Math.abs(Math.abs(a.delta) - targetDelta) ? b : a,
  );
}

export function runBacktest(spec: BacktestSpec, provider: DataProvider): BacktestRun {
  const t0 = Date.now();
  const dates = provider.tradingDates(spec.startDate, spec.endDate);
  const trades: BacktestTrade[] = [];
  const equityCurve: DailyEquityPoint[] = [];
  const diagnostics: string[] = [];
  const openTrades: Map<string, OpenTradeState> = new Map();

  let realized = 0;
  let cash = spec.startingCapital;

  for (const date of dates) {
    // 1. Walk every open trade through evaluateExit.
    for (const [tradeId, state] of Array.from(openTrades.entries())) {
      const snap = provider.snapshot(date, state.trade.ticker);
      if (!snap) continue;
      const contractToday = snap.contracts.find((c) => c.occSymbol === state.trade.contractSymbol);
      if (!contractToday) {
        diagnostics.push(`${date} ${state.trade.ticker}: contract ${state.trade.contractSymbol} dropped from chain`);
        continue;
      }

      const currentPx = contractToday.midPrice;
      const previousPeakPx = state.position.peakPx;
      state.position = {
        ...state.position,
        currentDelta: contractToday.delta,
        currentUnderlying: snap.underlyingPrice,
        peakPx: Math.max(previousPeakPx, currentPx),
      };
      state.peakUnderlying = Math.max(state.peakUnderlying, snap.underlyingPrice);

      const pullbackPct = state.peakUnderlying === 0 ? 0 :
        (snap.underlyingPrice - state.peakUnderlying) / state.peakUnderlying;
      const action: ExitAction = evaluateExit(
        state.position,
        currentPx,
        NO_REVERSAL,
        pullbackPct,
        new Date(date + 'T16:00:00Z'),
      );

      if (action.type === 'SCALE') {
        const exitQty = Math.min(action.qty, state.position.qtyRemaining);
        const exitPnl = (currentPx - state.trade.entryPrice) * 100 * exitQty;
        state.trade.exits.push({ date, qty: exitQty, price: currentPx, reason: action.reason });
        realized += exitPnl;
        state.position = {
          ...state.position,
          qtyRemaining: state.position.qtyRemaining - exitQty,
          tierExited: (state.position.tierExited + 1) as 0 | 1 | 2 | 3,
        };
      } else if (action.type === 'CLOSE') {
        const exitQty = state.position.qtyRemaining;
        const exitPnl = (currentPx - state.trade.entryPrice) * 100 * exitQty;
        state.trade.exits.push({ date, qty: exitQty, price: currentPx, reason: action.reason });
        realized += exitPnl;
        state.trade.finalPnl = state.trade.exits.reduce(
          (s, e) => s + (e.price - state.trade.entryPrice) * 100 * e.qty,
          0,
        );
        state.trade.finalPnlPct = state.trade.entryPrice === 0 ? 0 :
          state.trade.finalPnl / (state.trade.entryPrice * 100 * state.trade.qty);
        const entryMs = new Date(state.trade.entryDate + 'T16:00:00Z').getTime();
        const exitMs = new Date(date + 'T16:00:00Z').getTime();
        state.trade.durationDays = Math.max(1, Math.round((exitMs - entryMs) / 86_400_000));
        state.trade.closedReason = action.reason;
        trades.push(state.trade);
        openTrades.delete(tradeId);
      }
    }

    // 2. Look for entries on this date.
    for (const ticker of spec.universe) {
      if (Array.from(openTrades.values()).some((s) => s.trade.ticker === ticker)) continue;
      const snap = provider.snapshot(date, ticker);
      if (!snap || !snap.signal || !snap.signal.isEntryCandidate || !snap.signal.archetype) continue;

      const isBullish = snap.signal.archetype.includes('BULLISH');
      const targetDelta = snap.signal.archetype.startsWith('CONTRARIAN') ? 0.35 : 0.3;
      const dteRange: [number, number] = snap.signal.archetype.startsWith('CONTRARIAN') ? [21, 35] : [28, 50];
      const contract = pickEntryContract(snap, isBullish, targetDelta, dteRange);
      if (!contract) {
        diagnostics.push(`${date} ${ticker}: signal fired but no candidate contract (Δ=${targetDelta})`);
        continue;
      }

      // Crude sizing: 2% of account per trade, capped at $5K.
      const tradeBudget = Math.min(cash * 0.02, 5000);
      const qty = Math.max(1, Math.floor(tradeBudget / (contract.midPrice * 100)));
      const entryCost = contract.midPrice * 100 * qty;
      if (entryCost > cash) continue;

      const trade: BacktestTrade = {
        id: `${ticker}-${date}-${Math.random().toString(36).slice(2, 7)}`,
        ticker,
        archetype: snap.signal.archetype,
        entryDate: date,
        entryPrice: contract.midPrice,
        qty,
        contractSymbol: contract.occSymbol,
        strike: contract.strike,
        expiration: contract.expiration,
        exits: [],
        finalPnl: 0,
        finalPnlPct: 0,
        durationDays: 0,
        closedReason: '',
      };

      const position: Position = {
        id: trade.id,
        archetype: snap.signal.archetype,
        entryPx: contract.midPrice,
        entryDate: new Date(date + 'T16:00:00Z'),
        qtyOriginal: qty,
        qtyRemaining: qty,
        peakPx: contract.midPrice,
        tierExited: 0,
        currentDelta: contract.delta,
        signalActive: true,
        underlyingAtEntry: snap.underlyingPrice,
        currentUnderlying: snap.underlyingPrice,
        contract: snapshotToContract(contract, ticker),
        reservePending: false,
        reserveDeployedAt: null,
      };

      openTrades.set(trade.id, { trade, position, peakUnderlying: snap.underlyingPrice });
      cash -= entryCost;
    }

    // 3. Mark-to-market and equity curve.
    let unrealized = 0;
    for (const state of openTrades.values()) {
      const snap = provider.snapshot(date, state.trade.ticker);
      const c = snap?.contracts.find((x) => x.occSymbol === state.trade.contractSymbol);
      if (c) {
        unrealized += (c.midPrice - state.trade.entryPrice) * 100 * state.position.qtyRemaining;
      }
    }
    equityCurve.push({
      date,
      equity: spec.startingCapital + realized + unrealized,
      realizedPnl: realized,
      unrealizedPnl: unrealized,
      openTradeCount: openTrades.size,
    });
  }

  // 4. Force-close any still-open trades at the last available mid.
  for (const [, state] of openTrades) {
    state.trade.closedReason = 'backtest_window_ended';
    state.trade.finalPnl = state.trade.exits.reduce(
      (s, e) => s + (e.price - state.trade.entryPrice) * 100 * e.qty,
      0,
    );
    trades.push(state.trade);
  }

  return {
    spec,
    trades,
    equityCurve,
    stats: computeStats(trades, equityCurve),
    diagnostics,
    walltimeMs: Date.now() - t0,
  };
}
