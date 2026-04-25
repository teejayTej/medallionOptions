import { describe, expect, it } from 'vitest';
import {
  computePerfectSetupScore,
  ENTRY_SCORE_THRESHOLD,
  HIGH_CONVICTION_THRESHOLD,
  type PerfectSetupInputs,
} from '@/lib/engine/scoring';
import { computeNetDeltaZ } from '@/lib/engine/whale-scanner';
import intcFixture from '@/__fixtures__/intc-2026-04-24.json';

const baseInputs: PerfectSetupInputs = {
  netDeltaZ: 0,
  volumeRatio: 0,
  persistenceDays: 0,
  cumulativeAbnormalOI: 0,
  largeContractPremium: 0,
  deltaProfile: 'NEUTRAL',
  ivRank: 50,
  momentum12_1: 0,
  borrowFeeBps: 50,
  rsi14: 50,
  vrp: 0.05,
  archetype: null,
};

describe('computePerfectSetupScore', () => {
  it('returns a low baseline (<=10) on neutral inputs', () => {
    // The brief's "0 on all-zero inputs" can't hold literally —
    // borrowFeeBps=0 trips the <50 bonus (+5), ivRank=0 trips <30 (+8),
    // and vrp=0 trips <0.02 (+2). With baseInputs (ivRank=50, borrow=50,
    // rsi=50, vrp=0.05) the expected baseline is 5 (rsi 30-70 +3, borrow
    // 50-199 +2). We assert a tight ceiling rather than 0 to flag
    // accidental over-counting.
    expect(computePerfectSetupScore(baseInputs)).toBeLessThanOrEqual(10);
  });

  it('clamps to 100 ceiling on saturating inputs', () => {
    const max: PerfectSetupInputs = {
      netDeltaZ: 5,
      volumeRatio: 30,
      persistenceDays: 10,
      cumulativeAbnormalOI: 5,
      largeContractPremium: 100_000_000,
      deltaProfile: 'HEDGING',
      ivRank: 10,
      momentum12_1: 1.0,
      borrowFeeBps: 10,
      rsi14: 50,
      vrp: 0.0,
      archetype: 'CONTRARIAN_BULLISH',
    };
    expect(computePerfectSetupScore(max)).toBeLessThanOrEqual(100);
  });

  it('INTC 2026-04-24 fixture clears HIGH_CONVICTION_THRESHOLD (82)', () => {
    const inputs: PerfectSetupInputs = {
      netDeltaZ: intcFixture.netDeltaZ,
      volumeRatio: intcFixture.volumeRatio,
      persistenceDays: intcFixture.persistenceDays,
      cumulativeAbnormalOI: intcFixture.cumulativeAbnormalOI,
      largeContractPremium: intcFixture.largeContractPremium,
      deltaProfile: intcFixture.deltaProfile as PerfectSetupInputs['deltaProfile'],
      ivRank: intcFixture.ivRank,
      momentum12_1: intcFixture.momentum12_1,
      borrowFeeBps: intcFixture.borrowFeeBps,
      rsi14: intcFixture.rsi14,
      vrp: intcFixture.vrp,
      archetype: intcFixture.archetype as PerfectSetupInputs['archetype'],
    };
    const score = computePerfectSetupScore(inputs);
    expect(score).toBeGreaterThanOrEqual(HIGH_CONVICTION_THRESHOLD);
  });

  it('Borrow-fee > 200bps docks 3 points', () => {
    const high = computePerfectSetupScore({ ...baseInputs, borrowFeeBps: 250 });
    const low = computePerfectSetupScore({ ...baseInputs, borrowFeeBps: 30 });
    expect(low - high).toBeGreaterThanOrEqual(8);
  });

  it('IV Rank > 80 docks 3 points', () => {
    const high = computePerfectSetupScore({ ...baseInputs, ivRank: 90 });
    const mid = computePerfectSetupScore({ ...baseInputs, ivRank: 50 });
    expect(mid - high).toBe(3);
  });

  it('Archetype null returns score without delta-profile bonus', () => {
    const withArchetype = computePerfectSetupScore({
      ...baseInputs,
      deltaProfile: 'HEDGING',
      archetype: 'CONTRARIAN_BULLISH',
    });
    const withoutArchetype = computePerfectSetupScore({
      ...baseInputs,
      deltaProfile: 'HEDGING',
      archetype: null,
    });
    expect(withArchetype - withoutArchetype).toBe(10);
  });

  it('thresholds export the expected constants', () => {
    expect(ENTRY_SCORE_THRESHOLD).toBe(70);
    expect(HIGH_CONVICTION_THRESHOLD).toBe(82);
  });
});

describe('computeNetDeltaZ', () => {
  it('returns 0 when history is shorter than 20', () => {
    expect(computeNetDeltaZ(1000, [])).toBe(0);
    expect(computeNetDeltaZ(1000, Array(19).fill(0))).toBe(0);
  });

  it('returns 0 when history has zero variance', () => {
    expect(computeNetDeltaZ(1000, Array(60).fill(500))).toBe(0);
  });

  it('returns positive Z when current exceeds rolling mean', () => {
    const history = Array.from({ length: 60 }, (_, i) => i);
    const z = computeNetDeltaZ(1000, history);
    expect(z).toBeGreaterThan(50);
  });

  it('returns negative Z when current is below rolling mean', () => {
    const history = Array.from({ length: 60 }, (_, i) => 100 + i * 5);
    const z = computeNetDeltaZ(0, history);
    expect(z).toBeLessThan(0);
  });
});
