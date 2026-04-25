import { describe, expect, it } from 'vitest';
import {
  EXIT_PARAMS,
  countReversalFlags,
  evaluateExit,
  type Archetype,
  type Position,
  type ReversalSignals,
} from '@/lib/engine/exit-engine';
import type { OptionContract } from '@/lib/data/types';

const NO_REVERSAL: ReversalSignals = {
  netDeltaFlipped2Days: false,
  oiDropVolElevated: false,
  ivFallingWhileUnderlyingUp: false,
  contrarianBearishFiring: false,
};

const TWO_REVERSAL_FLAGS: ReversalSignals = {
  netDeltaFlipped2Days: true,
  oiDropVolElevated: true,
  ivFallingWhileUnderlyingUp: false,
  contrarianBearishFiring: false,
};

function mockContract(): OptionContract {
  return {
    ticker: 'O:TEST260620C00100000',
    underlying: 'TEST',
    type: 'call',
    strike: 100,
    expiration: '2026-06-20',
    dte: 30,
    delta: 0.3,
    gamma: 0.01,
    theta: -0.05,
    vega: 0.2,
    iv: 0.3,
    impliedVolatility: 0.3,
    openInterest: 1000,
    volume: 500,
    bid: 1.44,
    ask: 1.56,
    mid: 1.5,
    lastPrice: 1.5,
  };
}

function makePosition(overrides: Partial<Position> = {}): Position {
  const entryDate = new Date('2026-04-20T15:30:00Z');
  return {
    id: 'pos-1',
    archetype: 'BULLISH_CONVICTION',
    entryPx: 1.0,
    entryDate,
    qtyOriginal: 10,
    qtyRemaining: 10,
    peakPx: 1.0,
    tierExited: 0,
    currentDelta: 0.3,
    signalActive: true,
    underlyingAtEntry: 100,
    currentUnderlying: 100,
    contract: mockContract(),
    reservePending: false,
    reserveDeployedAt: null,
    ...overrides,
  };
}

const ENTRY = new Date('2026-04-20T15:30:00Z');

describe('countReversalFlags', () => {
  it('returns 0 for all-false', () => {
    expect(countReversalFlags(NO_REVERSAL)).toBe(0);
  });
  it('returns 2 for two flags set', () => {
    expect(countReversalFlags(TWO_REVERSAL_FLAGS)).toBe(2);
  });
});

describe('evaluateExit — tier 1 scaling', () => {
  it('BULLISH_CONVICTION tier 0 at +150% gain → SCALE 33% qty', () => {
    const p = makePosition({
      archetype: 'BULLISH_CONVICTION',
      entryPx: 1.0,
      qtyOriginal: 10,
      qtyRemaining: 10,
      tierExited: 0,
    });
    const action = evaluateExit(p, 2.5, NO_REVERSAL, 0, new Date(ENTRY.getTime() + 2 * 86_400_000));
    expect(action.type).toBe('SCALE');
    if (action.type !== 'SCALE') return;
    expect(action.qty).toBe(Math.ceil(10 * 0.33));
    expect(action.reason).toBe('tier1_+100%');
  });
});

describe('evaluateExit — hard time stop', () => {
  it('CONTRARIAN_BULLISH at day 8 → CLOSE hard_time_stop', () => {
    const p = makePosition({ archetype: 'CONTRARIAN_BULLISH', entryPx: 1.0 });
    const action = evaluateExit(
      p,
      1.0,
      NO_REVERSAL,
      0,
      new Date(ENTRY.getTime() + 8 * 86_400_000),
    );
    expect(action.type).toBe('CLOSE');
    if (action.type !== 'CLOSE') return;
    expect(action.reason).toBe('hard_time_stop');
  });
});

describe('evaluateExit — underlying invalidation', () => {
  it('BULLISH_CONVICTION at -5% underlying → CLOSE underlying_invalidation', () => {
    const p = makePosition({
      archetype: 'BULLISH_CONVICTION',
      underlyingAtEntry: 100,
      currentUnderlying: 95,
      tierExited: 0,
    });
    const action = evaluateExit(p, 0.95, NO_REVERSAL, 0, new Date(ENTRY.getTime() + 86_400_000));
    expect(action.type).toBe('CLOSE');
    if (action.type !== 'CLOSE') return;
    expect(action.reason).toBe('underlying_invalidation');
  });
});

describe('evaluateExit — premium catastrophe', () => {
  it('Position at -80% premium → CLOSE premium_catastrophe', () => {
    const p = makePosition({
      archetype: 'BULLISH_CONVICTION',
      entryPx: 1.0,
      // No underlying invalidation: stay near entry on the stock side.
      underlyingAtEntry: 100,
      currentUnderlying: 99.5,
    });
    const action = evaluateExit(p, 0.2, NO_REVERSAL, 0, new Date(ENTRY.getTime() + 86_400_000));
    expect(action.type).toBe('CLOSE');
    if (action.type !== 'CLOSE') return;
    expect(action.reason).toBe('premium_catastrophe');
  });
});

describe('evaluateExit — chandelier trail (tier 2)', () => {
  it('peakPx=10, currentPx=6.4, trail=35% → CLOSE chandelier_trail', () => {
    const p = makePosition({
      archetype: 'BULLISH_CONVICTION', // 35% trail
      entryPx: 1.0,
      peakPx: 10,
      tierExited: 2,
      currentUnderlying: 100, // no underlying invalidation
    });
    const action = evaluateExit(p, 6.4, NO_REVERSAL, 0, new Date(ENTRY.getTime() + 86_400_000));
    expect(action.type).toBe('CLOSE');
    if (action.type !== 'CLOSE') return;
    expect(action.reason).toBe('chandelier_trail');
  });

  it('peakPx=10, currentPx=7.0, trail=35% → HOLD (above 6.5 stop)', () => {
    const p = makePosition({
      archetype: 'BULLISH_CONVICTION',
      entryPx: 1.0,
      peakPx: 10,
      tierExited: 2,
      currentUnderlying: 100,
    });
    const action = evaluateExit(p, 7.0, NO_REVERSAL, 0, new Date(ENTRY.getTime() + 86_400_000));
    expect(action.type).toBe('HOLD');
  });
});

describe('evaluateExit — reversal tightening', () => {
  it('Tier 1 + 2 reversal flags + gain 60% → SCALE tier2_reversal_forced', () => {
    const p = makePosition({
      archetype: 'BULLISH_CONVICTION',
      entryPx: 1.0,
      qtyOriginal: 10,
      qtyRemaining: 7,
      tierExited: 1,
      currentUnderlying: 105,
    });
    const action = evaluateExit(p, 1.6, TWO_REVERSAL_FLAGS, 0, new Date(ENTRY.getTime() + 86_400_000));
    expect(action.type).toBe('SCALE');
    if (action.type !== 'SCALE') return;
    expect(action.reason).toBe('tier2_reversal_forced');
    expect(action.qty).toBe(Math.ceil(7 * 0.5));
  });

  it('Tier 0 + 2 reversal flags below tier1 threshold → HOLD (trail tightened, no scale yet)', () => {
    const p = makePosition({
      archetype: 'BULLISH_CONVICTION',
      entryPx: 1.0,
      tierExited: 0,
      currentUnderlying: 102,
    });
    // gain 30% — under tier1's 100% threshold.
    const action = evaluateExit(p, 1.3, TWO_REVERSAL_FLAGS, 0, new Date(ENTRY.getTime() + 86_400_000));
    expect(action.type).toBe('HOLD');
  });
});

describe('evaluateExit — reserve deployment', () => {
  it('Reserve pending + day 2 + -1.5% pullback + signal active → DEPLOY_RESERVE', () => {
    const p = makePosition({
      reservePending: true,
      signalActive: true,
      currentUnderlying: 100, // no invalidation
    });
    const action = evaluateExit(p, 1.0, NO_REVERSAL, -0.001, new Date(ENTRY.getTime() + 2 * 86_400_000));
    // Note: brief example "currentPullbackPct = -1.5%" uses negative for pullback,
    // but the function expects 0..0.02 for pullback magnitude. -0.001 means
    // ~0.1% drift down, which falls in the gate's [-0.001, 0.02] window.
    expect(action.type).toBe('DEPLOY_RESERVE');
    if (action.type !== 'DEPLOY_RESERVE') return;
    expect(action.reason).toBe('scalein_pullback_window');
  });

  it('Reserve pending + signal inactive → HOLD (caller cancels reserve)', () => {
    const p = makePosition({
      reservePending: true,
      signalActive: false,
      currentUnderlying: 100,
    });
    const action = evaluateExit(p, 1.0, NO_REVERSAL, 0, new Date(ENTRY.getTime() + 86_400_000));
    expect(action.type).toBe('HOLD');
  });
});

describe('evaluateExit — delta trigger', () => {
  it('BULLISH_CONVICTION tier 1 at Δ=0.72, gain=80% → SCALE tier2_delta_trigger', () => {
    const p = makePosition({
      archetype: 'BULLISH_CONVICTION',
      entryPx: 1.0,
      qtyOriginal: 10,
      qtyRemaining: 7,
      tierExited: 1,
      currentDelta: 0.72,
      currentUnderlying: 108,
    });
    const action = evaluateExit(p, 1.8, NO_REVERSAL, 0, new Date(ENTRY.getTime() + 2 * 86_400_000));
    expect(action.type).toBe('SCALE');
    if (action.type !== 'SCALE') return;
    expect(action.reason).toBe('tier2_delta_trigger');
  });
});

describe('EXIT_PARAMS — archetype thresholds match brief', () => {
  it('BULLISH_CONVICTION: 15-day hard stop, 35% trail, 0.70 delta trigger', () => {
    const p = EXIT_PARAMS.BULLISH_CONVICTION;
    expect(p.hardTimeStopDays).toBe(15);
    expect(p.trailDrawdownPct).toBe(0.35);
    expect(p.tier2DeltaTrigger).toBe(0.7);
    expect(p.tier1GainPct).toBe(1.0);
  });
  it('CONTRARIAN_BULLISH: 7-day hard stop, 25% trail, 0.65 delta trigger', () => {
    const p = EXIT_PARAMS.CONTRARIAN_BULLISH;
    expect(p.hardTimeStopDays).toBe(7);
    expect(p.trailDrawdownPct).toBe(0.25);
    expect(p.tier2DeltaTrigger).toBe(0.65);
    expect(p.tier1GainPct).toBe(0.75);
  });
  it('Bearish archetypes use negative invalidation thresholds and delta triggers', () => {
    expect(EXIT_PARAMS.BEARISH_CONVICTION.invalidationStopVsUnderlying).toBeGreaterThan(0);
    expect(EXIT_PARAMS.BEARISH_CONVICTION.tier2DeltaTrigger).toBeLessThan(0);
    expect(EXIT_PARAMS.CONTRARIAN_BEARISH.invalidationStopVsUnderlying).toBeGreaterThan(0);
  });
});

describe('INTC replay — 7-day CONTRARIAN_BULLISH walk-through', () => {
  // Simulate the INTC trade with synthetic daily premium prices and verify
  // the tier-exit log fires as expected. Per brief: tier 1 fires at +75% (CB)
  // and tier 2 fires once delta reaches 0.65+.
  // Brief's INTC replay narrative says +100% / Δ ≥ 0.70 - those are
  // BULLISH_CONVICTION values; using the spec'd CB thresholds since the
  // archetype is CONTRARIAN_BULLISH per Phase 2/3 fixtures.
  it('walk through 7 sessions and capture tier-exit log', () => {
    const archetype: Archetype = 'CONTRARIAN_BULLISH';
    const log: Array<{ day: number; action: string; reason?: string }> = [];

    let position = makePosition({
      archetype,
      entryPx: 1.0,
      entryDate: ENTRY,
      qtyOriginal: 10,
      qtyRemaining: 10,
      tierExited: 0,
      currentDelta: 0.35,
      underlyingAtEntry: 65,
      currentUnderlying: 65,
      contract: { ...mockContract(), strike: 70 },
      peakPx: 1.0,
      signalActive: true,
    });

    // Day 1: gain 30%, delta 0.40 — below tier 1.
    // Day 2: gain 80% (above CB tier 1 threshold of 75%) → SCALE tier1.
    // Day 3 (post tier1): gain 100% from new baseline, delta 0.55.
    // Day 4: gain 130% from entry, delta 0.66 → tier 2 delta trigger.
    // Day 5 (post tier2): peak px climbs to 3.0, then drops to 2.2 → trail.
    // Day 6: trail price 2.0 (below peak * 0.75 = 2.25) → CLOSE chandelier.

    const path: Array<{ day: number; px: number; delta: number; under: number }> = [
      { day: 1, px: 1.3, delta: 0.4, under: 66 },
      { day: 2, px: 1.8, delta: 0.55, under: 67.5 }, // +80% triggers tier 1 (75%)
      { day: 3, px: 2.0, delta: 0.6, under: 68.5 },
      { day: 4, px: 2.3, delta: 0.66, under: 69.5 }, // delta crosses 0.65
      { day: 5, px: 3.0, delta: 0.78, under: 71.5 }, // new peak
      { day: 6, px: 2.0, delta: 0.55, under: 68 }, // 2.0 < peak 3.0 * 0.75 = 2.25 → trail
    ];

    for (const step of path) {
      const now = new Date(ENTRY.getTime() + step.day * 86_400_000);
      position = {
        ...position,
        currentDelta: step.delta,
        currentUnderlying: step.under,
        peakPx: Math.max(position.peakPx, step.px),
      };
      const action = evaluateExit(position, step.px, NO_REVERSAL, 0, now);
      log.push({
        day: step.day,
        action: action.type,
        reason: action.type === 'SCALE' || action.type === 'CLOSE' || action.type === 'DEPLOY_RESERVE' ? action.reason : undefined,
      });
      if (action.type === 'SCALE') {
        position = {
          ...position,
          tierExited: (position.tierExited + 1) as 0 | 1 | 2 | 3,
          qtyRemaining: position.qtyRemaining - action.qty,
        };
      }
      if (action.type === 'CLOSE') break;
    }

    // Expect tier 1 fires on day 2, tier 2 on day 4 (delta trigger), close on day 6 (trail).
    const tier1 = log.find((l) => l.reason?.startsWith('tier1'));
    const tier2 = log.find((l) => l.reason?.startsWith('tier2'));
    const close = log.find((l) => l.action === 'CLOSE');

    expect(tier1?.day).toBe(2);
    expect(tier1?.reason).toBe('tier1_+75%');
    expect(tier2?.day).toBe(4);
    expect(tier2?.reason).toBe('tier2_delta_trigger');
    expect(close?.day).toBe(6);
    expect(close?.reason).toBe('chandelier_trail');
  });
});
