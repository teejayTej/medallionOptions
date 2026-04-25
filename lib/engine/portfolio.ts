// V5 Phase 5 — Half-Kelly position sizing with streak-survival
// dampening and a tiered drawdown circuit breaker.
//
// Existing trade-engine uses quarter-Kelly (× 0.25) with a 5% per-trade
// hard cap. V5 raises the base to half-Kelly (× 0.5) — but layers two
// counterweights so it isn't simply more aggressive:
//
//   1. Streak survival — after consecutive losses, scale sizing down
//      anti-martingale. Bet smaller when wrong, bet bigger when right.
//   2. Drawdown circuit breaker — track portfolio peak-to-trough; cut
//      sizing in tiers; HALT new positions at -20% drawdown.
//
// Net effect: equivalent or smaller risk than quarter-Kelly when in
// drawdown or losing streaks; larger when fresh and winning. Same
// per-trade hard cap (5% portfolio).

import type { Position } from '@/lib/store/positions';
import { realizedPnL } from '@/lib/store/positions';

// ──────────────────────────────────────────────────────────────────
// Half-Kelly
// ──────────────────────────────────────────────────────────────────

export interface KellyInputs {
  /** Probability of a winning trade, 0..1. Typically 1 - |delta|. */
  winRate: number;
  /** avgWin / avgLoss. With 50% profit target + 2x stop, this is 0.25. */
  winLossRatio: number;
}

/** Raw Kelly fraction. Negative when edge is negative. */
export function computeRawKelly(inputs: KellyInputs): number {
  const { winRate, winLossRatio } = inputs;
  if (winLossRatio <= 0) return 0;
  return (winRate * winLossRatio - (1 - winRate)) / winLossRatio;
}

/** Half-Kelly: × 0.5 of raw, floored at 0. Note this does NOT cap to 5%. */
export function computeHalfKellyFraction(inputs: KellyInputs): number {
  return Math.max(0, computeRawKelly(inputs) * 0.5);
}

// ──────────────────────────────────────────────────────────────────
// Streak survival
// ──────────────────────────────────────────────────────────────────

export interface StreakState {
  /** Most recent N trade outcomes, newest last. */
  recentTrades: Array<'W' | 'L'>;
  consecutiveLosses: number;
  consecutiveWins: number;
}

const STREAK_WINDOW = 10;

/** Derive streak state from closed positions. Newest last. */
export function deriveStreakState(positions: Position[]): StreakState {
  const closed = positions
    .filter((p) => p.status === 'closed')
    .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));

  const recent = closed.slice(-STREAK_WINDOW).map((p) => {
    const pnl = realizedPnL(p);
    return pnl !== null && pnl > 0 ? 'W' : 'L';
  }) as Array<'W' | 'L'>;

  let consecLosses = 0;
  let consecWins = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i] === 'L') {
      if (consecWins > 0) break;
      consecLosses++;
    } else {
      if (consecLosses > 0) break;
      consecWins++;
    }
  }

  return { recentTrades: recent, consecutiveLosses: consecLosses, consecutiveWins: consecWins };
}

/**
 * Streak multiplier (anti-martingale). Standard retail bands:
 *
 *   0–1 consecutive losses: 1.0x   (no penalty)
 *   2 losses:               0.75x  (caution)
 *   3 losses:               0.5x   (cooling)
 *   4 losses:               0.35x  (defensive)
 *   5+ losses:              0.25x  (deep freeze)
 *
 * Wins do NOT scale up — half-Kelly is already aggressive enough.
 */
export function computeStreakMultiplier(streak: StreakState): number {
  const n = streak.consecutiveLosses;
  if (n <= 1) return 1.0;
  if (n === 2) return 0.75;
  if (n === 3) return 0.5;
  if (n === 4) return 0.35;
  return 0.25;
}

// ──────────────────────────────────────────────────────────────────
// Drawdown circuit breaker
// ──────────────────────────────────────────────────────────────────

export type DrawdownLevel = 'none' | 'mild' | 'moderate' | 'severe' | 'emergency';

export interface DrawdownState {
  peakValue: number;
  currentValue: number;
  /** Negative number; -0.08 means -8% from peak. */
  currentDD: number;
  level: DrawdownLevel;
}

/**
 * Drawdown bands (portfolio value peak-to-trough):
 *
 *   0 to -5%:    'none'      (1.0x sizing)
 *   -5 to -10%:  'mild'      (0.75x)
 *   -10 to -15%: 'moderate'  (0.5x)
 *   -15 to -20%: 'severe'    (0.25x)
 *   below -20%:  'emergency' (HALT — no new positions)
 */
export function classifyDrawdown(peakValue: number, currentValue: number): DrawdownState {
  if (peakValue <= 0) {
    return { peakValue, currentValue, currentDD: 0, level: 'none' };
  }
  const dd = (currentValue - peakValue) / peakValue;
  let level: DrawdownLevel;
  if (dd > -0.05) level = 'none';
  else if (dd > -0.1) level = 'mild';
  else if (dd > -0.15) level = 'moderate';
  else if (dd > -0.2) level = 'severe';
  else level = 'emergency';
  return { peakValue, currentValue, currentDD: dd, level };
}

/** 0..1; 0 means HALT. */
export function computeDrawdownMultiplier(state: DrawdownState): number {
  switch (state.level) {
    case 'none': return 1.0;
    case 'mild': return 0.75;
    case 'moderate': return 0.5;
    case 'severe': return 0.25;
    case 'emergency': return 0;
  }
}

// ──────────────────────────────────────────────────────────────────
// Composite sizing
// ──────────────────────────────────────────────────────────────────

export const PER_TRADE_HARD_CAP = 0.05;

export interface SizingInputs {
  winRate: number;
  winLossRatio: number;
  /** Multiplier from regime detector (1.0 / 0.75 / 0.25). */
  regimeMultiplier: number;
  streak: StreakState;
  drawdown: DrawdownState;
}

export interface SizingBreakdown {
  rawKelly: number;
  halfKelly: number;
  afterRegime: number;
  afterStreak: number;
  afterDrawdown: number;
}

export interface SizingOutput {
  /** 0..0.05; 0 means do not size (halt or zero edge). */
  kellyFraction: number;
  /** True when drawdown is at emergency level — caller must skip new entries. */
  halt: boolean;
  breakdown: SizingBreakdown;
  reasoning: string[];
}

export function computePositionSizeV5(inputs: SizingInputs): SizingOutput {
  const reasoning: string[] = [];
  const rawKelly = computeRawKelly({
    winRate: inputs.winRate,
    winLossRatio: inputs.winLossRatio,
  });
  const halfKelly = Math.max(0, rawKelly * 0.5);

  if (rawKelly <= 0) {
    reasoning.push(`Negative edge (rawKelly=${rawKelly.toFixed(3)}) — no position`);
    return {
      kellyFraction: 0,
      halt: false,
      breakdown: { rawKelly, halfKelly: 0, afterRegime: 0, afterStreak: 0, afterDrawdown: 0 },
      reasoning,
    };
  }

  if (inputs.drawdown.level === 'emergency') {
    reasoning.push(
      `HALT: drawdown ${(inputs.drawdown.currentDD * 100).toFixed(1)}% at emergency level — no new positions`,
    );
    return {
      kellyFraction: 0,
      halt: true,
      breakdown: { rawKelly, halfKelly, afterRegime: 0, afterStreak: 0, afterDrawdown: 0 },
      reasoning,
    };
  }

  const streakMul = computeStreakMultiplier(inputs.streak);
  const ddMul = computeDrawdownMultiplier(inputs.drawdown);

  const afterRegime = halfKelly * inputs.regimeMultiplier;
  const afterStreak = afterRegime * streakMul;
  const afterDrawdown = afterStreak * ddMul;
  const kellyFraction = Math.min(afterDrawdown, PER_TRADE_HARD_CAP);

  reasoning.push(
    `Half-Kelly ${(halfKelly * 100).toFixed(2)}% → regime ×${inputs.regimeMultiplier} → streak ×${streakMul} (L=${inputs.streak.consecutiveLosses}) → DD ×${ddMul} (${inputs.drawdown.level} ${(inputs.drawdown.currentDD * 100).toFixed(1)}%)`,
  );
  if (afterDrawdown > PER_TRADE_HARD_CAP) {
    reasoning.push(`Capped at per-trade hard limit ${(PER_TRADE_HARD_CAP * 100).toFixed(0)}%`);
  }

  return {
    kellyFraction,
    halt: false,
    breakdown: { rawKelly, halfKelly, afterRegime, afterStreak, afterDrawdown },
    reasoning,
  };
}
