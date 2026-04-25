// V5 Phase 4 — Three-tier scale-out exit engine with chandelier trail.
//
// Strategy: archetype-specific because squeeze setups compress fast
// (harvest aggressively, 7-day hard stop) while conviction trends need
// room to run (15-day hard stop, wider trail).
//
// No hard premium stop. Stop on underlying price move (-4% against
// entry) and signal decay, not on option premium. A meaningful share
// of eventual winners touch -40% premium drawdown on spread artifacts
// before working. Position-size cap is the real downside backstop.

import type { OptionContract } from '@/lib/data/types';
import { FEATURES } from '@/lib/config/features';

export type Archetype =
  | 'CONTRARIAN_BULLISH'
  | 'BULLISH_CONVICTION'
  | 'CONTRARIAN_BEARISH'
  | 'BEARISH_CONVICTION';

export interface Position {
  id: string;
  archetype: Archetype;
  entryPx: number;
  entryDate: Date;
  qtyOriginal: number;
  qtyRemaining: number;
  peakPx: number;
  tierExited: 0 | 1 | 2 | 3;
  currentDelta: number;
  signalActive: boolean;
  underlyingAtEntry: number;
  currentUnderlying: number;
  contract: OptionContract;
  reservePending: boolean;
  reserveDeployedAt: Date | null;
}

export interface ReversalSignals {
  netDeltaFlipped2Days: boolean;
  oiDropVolElevated: boolean;
  ivFallingWhileUnderlyingUp: boolean;
  contrarianBearishFiring: boolean;
}

export type ExitAction =
  | { type: 'HOLD' }
  | { type: 'SCALE'; qty: number; reason: string }
  | { type: 'CLOSE'; reason: string }
  | { type: 'DEPLOY_RESERVE'; reason: string };

interface ExitParamsByArchetype {
  tier1GainPct: number;
  tier1Fraction: number;
  tier2GainPct: number;
  tier2Fraction: number;
  tier2DeltaTrigger: number;
  trailDrawdownPct: number;
  hardTimeStopDays: number;
  signalDecayDays: number;
  invalidationStopVsUnderlying: number;
}

export const EXIT_PARAMS: Record<Archetype, ExitParamsByArchetype> = {
  BULLISH_CONVICTION: {
    tier1GainPct: 1.0,
    tier1Fraction: 0.33,
    tier2GainPct: 2.5,
    tier2Fraction: 0.5,
    tier2DeltaTrigger: 0.7,
    trailDrawdownPct: 0.35,
    hardTimeStopDays: 15,
    signalDecayDays: 10,
    invalidationStopVsUnderlying: -0.04,
  },
  CONTRARIAN_BULLISH: {
    tier1GainPct: 0.75,
    tier1Fraction: 0.5,
    tier2GainPct: 1.5,
    tier2Fraction: 0.5,
    tier2DeltaTrigger: 0.65,
    trailDrawdownPct: 0.25,
    hardTimeStopDays: 7,
    signalDecayDays: 5,
    invalidationStopVsUnderlying: -0.03,
  },
  BEARISH_CONVICTION: {
    tier1GainPct: 0.8,
    tier1Fraction: 0.33,
    tier2GainPct: 2.0,
    tier2Fraction: 0.5,
    tier2DeltaTrigger: -0.7,
    trailDrawdownPct: 0.3,
    hardTimeStopDays: 12,
    signalDecayDays: 8,
    invalidationStopVsUnderlying: 0.04,
  },
  CONTRARIAN_BEARISH: {
    tier1GainPct: 0.6,
    tier1Fraction: 0.5,
    tier2GainPct: 1.25,
    tier2Fraction: 0.5,
    tier2DeltaTrigger: -0.65,
    trailDrawdownPct: 0.22,
    hardTimeStopDays: 7,
    signalDecayDays: 5,
    invalidationStopVsUnderlying: 0.03,
  },
};

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

/** Count true flags in the reversal set. */
export function countReversalFlags(r: ReversalSignals): number {
  return (
    Number(r.netDeltaFlipped2Days) +
    Number(r.oiDropVolElevated) +
    Number(r.ivFallingWhileUnderlyingUp) +
    Number(r.contrarianBearishFiring)
  );
}

/**
 * Decide what to do with a position right now. Pure function — mutations
 * (DB writes, order placement) live in the caller. Order of checks:
 *
 *   0. Reserve deployment (within 3-day window, ≤2% pullback, signal active)
 *   1. Hard time stop (archetype-specific days)
 *   2. Signal decay without progress
 *   3. Underlying invalidation (price-based, not premium-based)
 *   4. Catastrophe floor (-75% premium — gap-wipeout protection only)
 *   5. Reversal-triggered tightening (≥2 reversal flags)
 *   6. Tier 1 scale (gain threshold, fixed fraction)
 *   7. Tier 2 scale (gain OR delta trigger OR forced advance from reversal)
 *   8. Chandelier trail on final tranche (peak × (1 - effective trail))
 *   9. HOLD
 */
export function evaluateExit(
  p: Position,
  currentPx: number,
  reversal: ReversalSignals,
  currentPullbackPct: number,
  now: Date = new Date(),
): ExitAction {
  const params = EXIT_PARAMS[p.archetype];
  const gainPct = currentPx / p.entryPx - 1;
  const daysHeld = daysBetween(p.entryDate, now);
  const underlyingMove = p.currentUnderlying / p.underlyingAtEntry - 1;
  const isBullish = p.archetype.includes('BULLISH');

  // 0. Reserve deployment check (scaleInPlan from Phase 3).
  if (
    p.reservePending &&
    daysHeld <= 3 &&
    currentPullbackPct <= 0.02 &&
    currentPullbackPct >= -0.001 &&
    p.signalActive
  ) {
    return { type: 'DEPLOY_RESERVE', reason: 'scalein_pullback_window' };
  }
  if (p.reservePending && !p.signalActive) {
    // Flow reversed → caller is expected to cancel the reserve flag.
    return { type: 'HOLD' };
  }

  // 1. Hard time stop.
  if (daysHeld >= params.hardTimeStopDays) {
    return { type: 'CLOSE', reason: 'hard_time_stop' };
  }

  // 2. Signal decay without progress.
  if (daysHeld >= params.signalDecayDays && !p.signalActive && gainPct < 0.25) {
    return { type: 'CLOSE', reason: 'signal_decay_no_progress' };
  }

  // 3. Underlying invalidation (stock-based, not premium-based).
  const invalidated = isBullish
    ? underlyingMove <= params.invalidationStopVsUnderlying
    : underlyingMove >= params.invalidationStopVsUnderlying;
  if (invalidated) return { type: 'CLOSE', reason: 'underlying_invalidation' };

  // 4. Catastrophe floor — gap-wipeout protection only, not a premium stop.
  if (gainPct <= -0.75) return { type: 'CLOSE', reason: 'premium_catastrophe' };

  // 5. Reversal-triggered tightening (≥2 reversal flags).
  let effectiveTrail = params.trailDrawdownPct;
  let forceAdvanceToTier2 = false;
  if (countReversalFlags(reversal) >= 2 && p.tierExited < 2) {
    effectiveTrail *= 0.6; // tighten 40%
    forceAdvanceToTier2 = gainPct > 0.5; // only if in-profit
  }

  // 6. Tier 1.
  if (p.tierExited === 0 && gainPct >= params.tier1GainPct) {
    return {
      type: 'SCALE',
      qty: Math.ceil(p.qtyOriginal * params.tier1Fraction),
      reason: `tier1_+${Math.round(params.tier1GainPct * 100)}%`,
    };
  }

  // 7. Tier 2: gain threshold, delta trigger, or reversal-forced advance.
  const deltaTriggered = isBullish
    ? p.currentDelta >= params.tier2DeltaTrigger
    : p.currentDelta <= params.tier2DeltaTrigger;
  if (
    p.tierExited === 1 &&
    (gainPct >= params.tier2GainPct || deltaTriggered || forceAdvanceToTier2)
  ) {
    return {
      type: 'SCALE',
      qty: Math.ceil(p.qtyRemaining * params.tier2Fraction),
      reason: deltaTriggered
        ? 'tier2_delta_trigger'
        : forceAdvanceToTier2
          ? 'tier2_reversal_forced'
          : 'tier2_gain',
    };
  }

  // 8. Chandelier trail on final tranche.
  if (p.tierExited === 2) {
    const trailStop = p.peakPx * (1 - effectiveTrail);
    if (currentPx <= trailStop) {
      return { type: 'CLOSE', reason: 'chandelier_trail' };
    }
  }

  return { type: 'HOLD' };
}

/**
 * Daily monitor tick. Skeleton — wired off until FEATURES.V5_EXITS is true.
 * Caller is expected to run this once per session for every open position.
 * Returns the actions to apply; persistence and order placement are the
 * caller's responsibility.
 */
export interface MonitorInput {
  position: Position;
  currentPx: number;
  reversal: ReversalSignals;
  currentPullbackPct: number;
}

export function dailyExitMonitorTick(inputs: MonitorInput[]): Array<{ position: Position; action: ExitAction }> {
  if (!FEATURES.V5_EXITS) return [];
  const now = new Date();
  return inputs.map((i) => ({
    position: i.position,
    action: evaluateExit(i.position, i.currentPx, i.reversal, i.currentPullbackPct, now),
  }));
}
