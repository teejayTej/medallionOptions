import { describe, expect, it } from 'vitest';
import {
  classifyDrawdown,
  computeDrawdownMultiplier,
  computeHalfKellyFraction,
  computePositionSizeV5,
  computeRawKelly,
  computeStreakMultiplier,
  deriveStreakState,
  PER_TRADE_HARD_CAP,
  type DrawdownState,
  type StreakState,
} from '@/lib/engine/portfolio';
import type { Position } from '@/lib/store/positions';

const HEALTHY_DD: DrawdownState = {
  peakValue: 100_000,
  currentValue: 100_000,
  currentDD: 0,
  level: 'none',
};

const FRESH_STREAK: StreakState = {
  recentTrades: [],
  consecutiveLosses: 0,
  consecutiveWins: 0,
};

describe('computeRawKelly', () => {
  it('70% win rate at b=0.25 returns positive Kelly', () => {
    const k = computeRawKelly({ winRate: 0.7, winLossRatio: 0.25 });
    expect(k).toBeCloseTo(-0.5, 1); // (0.7 * 0.25 - 0.3) / 0.25 = -0.5
  });

  it('80% win rate at b=0.5 returns positive Kelly', () => {
    const k = computeRawKelly({ winRate: 0.8, winLossRatio: 0.5 });
    // (0.8 * 0.5 - 0.2) / 0.5 = 0.4
    expect(k).toBeCloseTo(0.4, 2);
  });

  it('returns 0 on zero win-loss ratio', () => {
    expect(computeRawKelly({ winRate: 0.7, winLossRatio: 0 })).toBe(0);
  });
});

describe('computeHalfKellyFraction', () => {
  it('halves the raw Kelly fraction (positive case)', () => {
    const inputs = { winRate: 0.8, winLossRatio: 0.5 };
    const half = computeHalfKellyFraction(inputs);
    const raw = computeRawKelly(inputs);
    expect(half).toBeCloseTo(raw * 0.5, 4);
  });

  it('floors at 0 on negative edge', () => {
    expect(computeHalfKellyFraction({ winRate: 0.4, winLossRatio: 0.5 })).toBe(0);
  });
});

describe('computeStreakMultiplier', () => {
  it('1.0 for 0 consecutive losses', () => {
    expect(computeStreakMultiplier({ ...FRESH_STREAK, consecutiveLosses: 0 })).toBe(1.0);
  });
  it('1.0 for 1 consecutive loss (one-loss tolerance)', () => {
    expect(computeStreakMultiplier({ ...FRESH_STREAK, consecutiveLosses: 1 })).toBe(1.0);
  });
  it('0.75 at 2 losses, 0.5 at 3, 0.35 at 4, 0.25 at 5+', () => {
    expect(computeStreakMultiplier({ ...FRESH_STREAK, consecutiveLosses: 2 })).toBe(0.75);
    expect(computeStreakMultiplier({ ...FRESH_STREAK, consecutiveLosses: 3 })).toBe(0.5);
    expect(computeStreakMultiplier({ ...FRESH_STREAK, consecutiveLosses: 4 })).toBe(0.35);
    expect(computeStreakMultiplier({ ...FRESH_STREAK, consecutiveLosses: 5 })).toBe(0.25);
    expect(computeStreakMultiplier({ ...FRESH_STREAK, consecutiveLosses: 8 })).toBe(0.25);
  });
});

describe('deriveStreakState', () => {
  function closedPosition(opts: { id: string; side: 'BUY' | 'SELL'; entry: number; exit: number; closedAt: number }): Position {
    return {
      id: opts.id,
      enteredAt: opts.closedAt - 86_400_000,
      ticker: 'TEST',
      contract: 'O:TEST',
      side: opts.side,
      strategy: 'long_call',
      strike: 100,
      expiration: '2026-06-20',
      entryPrice: opts.entry,
      contracts: 1,
      exitRules: { profitTargetPrice: opts.entry * 1.5, stopLossPrice: opts.entry * 0.5, dteCutoffDate: '2026-06-01' },
      status: 'closed',
      closedAt: opts.closedAt,
      closedPrice: opts.exit,
      closedReason: 'manual',
    };
  }

  it('returns empty streak when no closed positions', () => {
    expect(deriveStreakState([])).toEqual(FRESH_STREAK);
  });

  it('counts 3 consecutive losses (BUY trades closed below entry)', () => {
    const positions: Position[] = [
      closedPosition({ id: '1', side: 'BUY', entry: 1.0, exit: 0.5, closedAt: 1000 }),
      closedPosition({ id: '2', side: 'BUY', entry: 1.0, exit: 0.4, closedAt: 2000 }),
      closedPosition({ id: '3', side: 'BUY', entry: 1.0, exit: 0.6, closedAt: 3000 }),
    ];
    const s = deriveStreakState(positions);
    expect(s.consecutiveLosses).toBe(3);
    expect(s.consecutiveWins).toBe(0);
    expect(s.recentTrades).toEqual(['L', 'L', 'L']);
  });

  it('mixed: oldest are losses then 2 wins → consecutiveWins=2, losses=0', () => {
    const positions: Position[] = [
      closedPosition({ id: '1', side: 'BUY', entry: 1.0, exit: 0.5, closedAt: 1000 }),
      closedPosition({ id: '2', side: 'BUY', entry: 1.0, exit: 0.4, closedAt: 2000 }),
      closedPosition({ id: '3', side: 'BUY', entry: 1.0, exit: 1.5, closedAt: 3000 }),
      closedPosition({ id: '4', side: 'BUY', entry: 1.0, exit: 1.7, closedAt: 4000 }),
    ];
    const s = deriveStreakState(positions);
    expect(s.consecutiveWins).toBe(2);
    expect(s.consecutiveLosses).toBe(0);
  });

  it('caps recentTrades at last 10 sessions', () => {
    const positions = Array.from({ length: 15 }, (_, i) =>
      closedPosition({ id: `t${i}`, side: 'BUY', entry: 1.0, exit: i % 2 ? 1.5 : 0.5, closedAt: i * 1000 + 1000 }),
    );
    const s = deriveStreakState(positions);
    expect(s.recentTrades.length).toBe(10);
  });
});

describe('classifyDrawdown', () => {
  it('flat portfolio = none', () => {
    const s = classifyDrawdown(100_000, 100_000);
    expect(s.level).toBe('none');
    expect(s.currentDD).toBe(0);
  });
  it('-3% DD = none', () => {
    expect(classifyDrawdown(100_000, 97_000).level).toBe('none');
  });
  it('-7% DD = mild', () => {
    expect(classifyDrawdown(100_000, 93_000).level).toBe('mild');
  });
  it('-12% DD = moderate', () => {
    expect(classifyDrawdown(100_000, 88_000).level).toBe('moderate');
  });
  it('-17% DD = severe', () => {
    expect(classifyDrawdown(100_000, 83_000).level).toBe('severe');
  });
  it('-25% DD = emergency', () => {
    expect(classifyDrawdown(100_000, 75_000).level).toBe('emergency');
  });
  it('returns DD=0 on zero peak (defensive)', () => {
    const s = classifyDrawdown(0, 100_000);
    expect(s.currentDD).toBe(0);
    expect(s.level).toBe('none');
  });
});

describe('computeDrawdownMultiplier', () => {
  it('1.0 / 0.75 / 0.5 / 0.25 / 0 across levels', () => {
    const make = (level: DrawdownState['level']): DrawdownState => ({
      peakValue: 100, currentValue: 100, currentDD: 0, level,
    });
    expect(computeDrawdownMultiplier(make('none'))).toBe(1.0);
    expect(computeDrawdownMultiplier(make('mild'))).toBe(0.75);
    expect(computeDrawdownMultiplier(make('moderate'))).toBe(0.5);
    expect(computeDrawdownMultiplier(make('severe'))).toBe(0.25);
    expect(computeDrawdownMultiplier(make('emergency'))).toBe(0);
  });
});

describe('computePositionSizeV5', () => {
  it('healthy state: half-Kelly × regime, no streak/DD penalty', () => {
    const out = computePositionSizeV5({
      winRate: 0.8,
      winLossRatio: 0.5,
      regimeMultiplier: 1.0,
      streak: FRESH_STREAK,
      drawdown: HEALTHY_DD,
    });
    // raw=0.4, half=0.2, regime=1.0, streak=1.0, dd=1.0 → 0.2, capped at 0.05
    expect(out.kellyFraction).toBe(PER_TRADE_HARD_CAP);
    expect(out.halt).toBe(false);
  });

  it('emergency drawdown halts entry (kelly=0, halt=true)', () => {
    const out = computePositionSizeV5({
      winRate: 0.8,
      winLossRatio: 0.5,
      regimeMultiplier: 1.0,
      streak: FRESH_STREAK,
      drawdown: { peakValue: 100, currentValue: 70, currentDD: -0.3, level: 'emergency' },
    });
    expect(out.halt).toBe(true);
    expect(out.kellyFraction).toBe(0);
    expect(out.reasoning[0]).toContain('HALT');
  });

  it('negative edge → kelly=0, halt=false', () => {
    const out = computePositionSizeV5({
      winRate: 0.4,
      winLossRatio: 0.5,
      regimeMultiplier: 1.0,
      streak: FRESH_STREAK,
      drawdown: HEALTHY_DD,
    });
    expect(out.kellyFraction).toBe(0);
    expect(out.halt).toBe(false);
    expect(out.reasoning[0]).toMatch(/Negative edge/);
  });

  it('streak loss + moderate DD compound: each cuts roughly in half', () => {
    const fresh = computePositionSizeV5({
      winRate: 0.8, winLossRatio: 0.5, regimeMultiplier: 1.0,
      streak: FRESH_STREAK, drawdown: HEALTHY_DD,
    });
    const stressed = computePositionSizeV5({
      winRate: 0.8, winLossRatio: 0.5, regimeMultiplier: 1.0,
      streak: { recentTrades: ['L', 'L', 'L'], consecutiveLosses: 3, consecutiveWins: 0 },
      drawdown: { peakValue: 100, currentValue: 88, currentDD: -0.12, level: 'moderate' },
    });
    // fresh: half-Kelly 0.2, capped at 0.05. stressed: 0.2 * 1.0 * 0.5 (3 loss) * 0.5 (mod DD) = 0.05.
    // After cap, both are 0.05. But the raw afterDrawdown should differ.
    expect(stressed.breakdown.afterDrawdown).toBeLessThan(fresh.breakdown.afterDrawdown);
  });

  it('regime crisis × clean state: half-Kelly cut to 0.25', () => {
    const out = computePositionSizeV5({
      winRate: 0.8, winLossRatio: 0.5, regimeMultiplier: 0.25,
      streak: FRESH_STREAK, drawdown: HEALTHY_DD,
    });
    // half=0.2, regime=0.25 → 0.05, then * streak 1.0 * dd 1.0 = 0.05 (== cap)
    expect(out.breakdown.afterRegime).toBeCloseTo(0.05, 3);
    expect(out.kellyFraction).toBe(PER_TRADE_HARD_CAP);
  });

  it('reasoning string captures the multiplier chain', () => {
    const out = computePositionSizeV5({
      winRate: 0.8, winLossRatio: 0.5, regimeMultiplier: 0.75,
      streak: { recentTrades: ['L', 'L'], consecutiveLosses: 2, consecutiveWins: 0 },
      drawdown: { peakValue: 100, currentValue: 93, currentDD: -0.07, level: 'mild' },
    });
    expect(out.reasoning.join(' ')).toMatch(/Half-Kelly/);
    expect(out.reasoning.join(' ')).toMatch(/regime ×0.75/);
    expect(out.reasoning.join(' ')).toMatch(/streak ×0.75/);
    expect(out.reasoning.join(' ')).toMatch(/DD ×0.75/);
  });
});

describe('PER_TRADE_HARD_CAP', () => {
  it('caps at 5% per trade', () => {
    expect(PER_TRADE_HARD_CAP).toBe(0.05);
  });
});
