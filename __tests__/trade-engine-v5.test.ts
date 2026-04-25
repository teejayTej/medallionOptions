import { describe, expect, it } from 'vitest';
import {
  CONTRACT_RULES,
  DEFAULT_SCALE_IN_PLAN,
  passesLiquidityGate,
  selectContract,
  type V5Archetype,
} from '@/lib/engine/trade-engine';
import type { OptionContract } from '@/lib/data/types';

const TODAY = new Date();

function expiryDaysOut(dte: number): string {
  const d = new Date(TODAY.getTime() + dte * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function mockContract(opts: Partial<OptionContract>): OptionContract {
  const mid = opts.mid ?? 1.5;
  const halfSpread = mid * 0.04;
  return {
    ticker: opts.ticker ?? `O:TEST${(opts.strike ?? 100) * 1000}`,
    underlying: opts.underlying ?? 'TEST',
    type: opts.type ?? 'call',
    strike: opts.strike ?? 100,
    expiration: opts.expiration ?? expiryDaysOut(opts.dte ?? 30),
    dte: opts.dte ?? 30,
    delta: opts.delta ?? 0.3,
    gamma: opts.gamma ?? 0.01,
    theta: opts.theta ?? -0.05,
    vega: opts.vega ?? 0.2,
    iv: opts.iv ?? 0.3,
    impliedVolatility: opts.impliedVolatility ?? 0.3,
    openInterest: opts.openInterest ?? 1000,
    volume: opts.volume ?? 500,
    bid: opts.bid ?? mid - halfSpread,
    ask: opts.ask ?? mid + halfSpread,
    mid,
    lastPrice: opts.lastPrice ?? mid,
  };
}

function buildCallChain(spot: number, archetype: V5Archetype): OptionContract[] {
  const rules = CONTRACT_RULES[archetype];
  const isCall = archetype.includes('BULLISH');
  const type: OptionContract['type'] = isCall ? 'call' : 'put';
  const out: OptionContract[] = [];
  // Build strikes around spot at every $0.50 spanning ladder offsets ± buffer.
  const offsetMin = Math.min(...rules.ladderOffsets) - 0.05;
  const offsetMax = Math.max(...rules.ladderOffsets) + 0.05;
  const dteMid = rules.dteTarget;
  for (let pct = offsetMin; pct <= offsetMax; pct += 0.005) {
    const strike = Math.round((spot * (1 + pct)) * 2) / 2;
    // Place delta linearly across the band so every strike has plausible delta.
    const fraction = (pct - offsetMin) / (offsetMax - offsetMin);
    const delta = isCall
      ? rules.deltaRange[1] - fraction * (rules.deltaRange[1] - rules.deltaRange[0])
      : rules.deltaRange[0] + fraction * (rules.deltaRange[1] - rules.deltaRange[0]);
    out.push(
      mockContract({
        underlying: 'TEST',
        type,
        strike,
        dte: dteMid,
        delta,
        openInterest: 2000,
        volume: 800,
        mid: 1.5,
      }),
    );
  }
  return out;
}

describe('CONTRACT_RULES', () => {
  it('CONTRARIAN_BULLISH delta range matches spec exactly', () => {
    expect(CONTRACT_RULES.CONTRARIAN_BULLISH.deltaRange).toEqual([0.28, 0.45]);
    expect(CONTRACT_RULES.CONTRARIAN_BULLISH.dteRange).toEqual([21, 35]);
    expect(CONTRACT_RULES.CONTRARIAN_BULLISH.ladderWeights).toEqual([0.55, 0.3, 0.15]);
    expect(CONTRACT_RULES.CONTRARIAN_BULLISH.ladderOffsets).toEqual([0.03, 0.07, 0.12]);
  });

  it('BULLISH_CONVICTION delta range and ladder match spec', () => {
    expect(CONTRACT_RULES.BULLISH_CONVICTION.deltaRange).toEqual([0.22, 0.4]);
    expect(CONTRACT_RULES.BULLISH_CONVICTION.dteRange).toEqual([28, 50]);
    expect(CONTRACT_RULES.BULLISH_CONVICTION.ladderWeights).toEqual([0.5, 0.3, 0.2]);
  });

  it('CONTRARIAN_BEARISH uses negative deltas and offsets', () => {
    expect(CONTRACT_RULES.CONTRARIAN_BEARISH.deltaRange[0]).toBeLessThan(0);
    expect(CONTRACT_RULES.CONTRARIAN_BEARISH.deltaRange[1]).toBeLessThan(0);
    expect(CONTRACT_RULES.CONTRARIAN_BEARISH.ladderOffsets[0]).toBeLessThan(0);
  });
});

describe('passesLiquidityGate', () => {
  it('rejects OI below 500', () => {
    const c = mockContract({ openInterest: 100, volume: 500 });
    expect(passesLiquidityGate(c)).toBe(false);
  });

  it('rejects volume below 100', () => {
    const c = mockContract({ openInterest: 1000, volume: 50 });
    expect(passesLiquidityGate(c)).toBe(false);
  });

  it('rejects spread > 10% of mid', () => {
    const c = mockContract({
      openInterest: 1000,
      volume: 500,
      mid: 1.0,
      bid: 0.9,
      ask: 1.12, // spread = 0.22, 22% of mid
    });
    expect(passesLiquidityGate(c)).toBe(false);
  });

  it('accepts contract meeting all three thresholds', () => {
    const c = mockContract({ openInterest: 1000, volume: 500 });
    expect(passesLiquidityGate(c)).toBe(true);
  });
});

describe('selectContract', () => {
  it('BULLISH_CONVICTION at $25 spot, $5000 budget returns 3 ladder orders with 50/30/20 budget weights', () => {
    const chain = buildCallChain(25, 'BULLISH_CONVICTION');
    const orders = selectContract('BULLISH_CONVICTION', chain, 25, 5000);
    expect(orders).toHaveLength(3);
    expect(orders[0].ladderSlot).toBe(0);
    expect(orders[1].ladderSlot).toBe(1);
    expect(orders[2].ladderSlot).toBe(2);
    expect(orders[0].slotBudget).toBeCloseTo(2500, 1);
    expect(orders[1].slotBudget).toBeCloseTo(1500, 1);
    expect(orders[2].slotBudget).toBeCloseTo(1000, 1);
    // Each order has a positive qty (≥1 minimum).
    orders.forEach((o) => expect(o.qty).toBeGreaterThanOrEqual(1));
  });

  it('budget < $1500 returns single inner-strike order (small-budget branch)', () => {
    const chain = buildCallChain(25, 'BULLISH_CONVICTION');
    const orders = selectContract('BULLISH_CONVICTION', chain, 25, 1000);
    expect(orders).toHaveLength(1);
    expect(orders[0].ladderSlot).toBe(0);
    expect(orders[0].slotBudget).toBe(1000);
  });

  it('empty candidate set returns []', () => {
    // chain has wrong type, won't match call filter
    const chain = [mockContract({ type: 'put', delta: -0.3, dte: 30, openInterest: 1000, volume: 500 })];
    const orders = selectContract('BULLISH_CONVICTION', chain, 25, 5000);
    expect(orders).toEqual([]);
  });

  it('BEARISH_CONVICTION at $100 spot returns 3 put orders with strikes BELOW spot', () => {
    const chain = buildCallChain(100, 'BEARISH_CONVICTION');
    const orders = selectContract('BEARISH_CONVICTION', chain, 100, 5000);
    expect(orders).toHaveLength(3);
    orders.forEach((o) => {
      expect(o.contract.type).toBe('put');
      expect(o.contract.strike).toBeLessThan(100);
    });
  });

  it('INTC replay: CONTRARIAN_BULLISH at spot=$58, $5000 budget picks strikes in 60-65 range', () => {
    // Build a chain spanning 58 to 80 to give selectContract maximum room.
    const chain: OptionContract[] = [];
    for (let strike = 58; strike <= 80; strike += 1) {
      const fraction = (strike - 58) / 22;
      // Inner strikes at higher delta, outer at lower — within CB range.
      const delta = 0.45 - fraction * 0.17;
      if (delta < 0.28 || delta > 0.45) continue;
      chain.push(mockContract({
        underlying: 'INTC',
        type: 'call',
        strike,
        dte: 28,
        delta,
        openInterest: 2000,
        volume: 800,
        mid: 1.5,
      }));
    }
    const orders = selectContract('CONTRARIAN_BULLISH', chain, 58, 5000);
    expect(orders).toHaveLength(3);
    // CB ladder offsets: 3% / 7% / 12% of spot 58 = $59.74 / $62.06 / $64.96
    // Per the brief, all three should land in the 60-65 sweet spot, NOT 74C.
    orders.forEach((o) => {
      expect(o.contract.strike).toBeGreaterThanOrEqual(59);
      expect(o.contract.strike).toBeLessThanOrEqual(66);
    });
    expect(orders.map((o) => o.contract.strike).every((s) => s !== 74)).toBe(true);
  });
});

describe('DEFAULT_SCALE_IN_PLAN', () => {
  it('matches the brief 70/30 with 3-day 2%-pullback window', () => {
    expect(DEFAULT_SCALE_IN_PLAN.initialDeploymentPct).toBe(0.7);
    expect(DEFAULT_SCALE_IN_PLAN.reserveDeploymentPct).toBe(0.3);
    expect(DEFAULT_SCALE_IN_PLAN.reserveWindow.days).toBe(3);
    expect(DEFAULT_SCALE_IN_PLAN.reserveWindow.maxPullbackPct).toBe(0.02);
    expect(DEFAULT_SCALE_IN_PLAN.reserveCancellationTrigger).toBe('flow_reversal');
  });
});
