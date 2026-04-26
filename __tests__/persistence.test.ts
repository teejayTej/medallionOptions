import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// We mock cwd before importing persistence so the SNAPSHOTS_DIR resolves
// to a temp directory unique to each test run.
let TMP_ROOT = '';

beforeEach(async () => {
  TMP_ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'medallion-persistence-'));
  vi.spyOn(process, 'cwd').mockReturnValue(TMP_ROOT);
  vi.resetModules();
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await fs.rm(TMP_ROOT, { recursive: true, force: true });
  } catch {}
});

describe('persistence — read/append round trip', () => {
  it('returns [] for a ticker with no file', async () => {
    const { readSnapshots } = await import('@/lib/data/persistence');
    expect(await readSnapshots('NVDA')).toEqual([]);
  });

  it('append + read round-trips a single snapshot', async () => {
    const { appendSnapshot, readSnapshots } = await import('@/lib/data/persistence');
    await appendSnapshot('NVDA', mockSnap('2026-04-25', { netDelta: 1000 }));
    const read = await readSnapshots('NVDA');
    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({ date: '2026-04-25', netDelta: 1000 });
  });

  it('appending the same date replaces the prior snapshot (no duplicates)', async () => {
    const { appendSnapshot, readSnapshots } = await import('@/lib/data/persistence');
    await appendSnapshot('AAPL', mockSnap('2026-04-25', { netDelta: 1000 }));
    await appendSnapshot('AAPL', mockSnap('2026-04-25', { netDelta: 2000 }));
    const read = await readSnapshots('AAPL');
    expect(read).toHaveLength(1);
    expect(read[0].netDelta).toBe(2000);
  });

  it('keeps snapshots sorted by date', async () => {
    const { appendSnapshot, readSnapshots } = await import('@/lib/data/persistence');
    await appendSnapshot('SPY', mockSnap('2026-04-25', { netDelta: 1 }));
    await appendSnapshot('SPY', mockSnap('2026-04-23', { netDelta: 2 }));
    await appendSnapshot('SPY', mockSnap('2026-04-24', { netDelta: 3 }));
    const read = await readSnapshots('SPY');
    expect(read.map((s) => s.date)).toEqual(['2026-04-23', '2026-04-24', '2026-04-25']);
  });

  it('readRecentSnapshots respects lookback', async () => {
    const { appendSnapshot, readRecentSnapshots } = await import('@/lib/data/persistence');
    for (let i = 0; i < 30; i++) {
      const d = new Date('2026-01-01');
      d.setDate(d.getDate() + i);
      await appendSnapshot('X', mockSnap(d.toISOString().slice(0, 10), { netDelta: i }));
    }
    const last10 = await readRecentSnapshots('X', 10);
    expect(last10).toHaveLength(10);
    expect(last10[0].netDelta).toBe(20);
    expect(last10[9].netDelta).toBe(29);
  });
});

describe('persistence — derived metrics', () => {
  it('netDeltaZ returns 0 with insufficient history', async () => {
    const { computeNetDeltaZScore } = await import('@/lib/data/persistence');
    expect(computeNetDeltaZScore(1000, [])).toBe(0);
    expect(computeNetDeltaZScore(1000, Array.from({ length: 19 }, (_, i) => mockSnap(`d${i}`, { netDelta: i })))).toBe(0);
  });

  it('netDeltaZ returns positive Z when current exceeds baseline mean', async () => {
    const { computeNetDeltaZScore } = await import('@/lib/data/persistence');
    const history = Array.from({ length: 60 }, (_, i) => mockSnap(`d${i}`, { netDelta: i }));
    const z = computeNetDeltaZScore(10000, history);
    expect(z).toBeGreaterThan(50);
  });

  it('persistenceDays counts consecutive same-sign sessions newest-first', async () => {
    const { computePersistenceDays } = await import('@/lib/data/persistence');
    // Simulated history: oldest...newest with mixed signs at the tail.
    const history = [
      mockSnap('d0', { netDelta: -50 }),
      mockSnap('d1', { netDelta: -30 }),
      mockSnap('d2', { netDelta: 10 }),  // sign flip — anything before this is irrelevant
      mockSnap('d3', { netDelta: 40 }),
      mockSnap('d4', { netDelta: 20 }),
    ];
    expect(computePersistenceDays(15, history)).toBe(4);
  });

  it('persistenceDays returns 0 when current netDelta is 0', async () => {
    const { computePersistenceDays } = await import('@/lib/data/persistence');
    const history = [mockSnap('d0', { netDelta: 100 })];
    expect(computePersistenceDays(0, history)).toBe(0);
  });

  it('cumulativeAbnormalOI returns 0 with too little history', async () => {
    const { computeCumulativeAbnormalOI } = await import('@/lib/data/persistence');
    expect(computeCumulativeAbnormalOI([])).toBe(0);
    expect(computeCumulativeAbnormalOI(Array.from({ length: 10 }, (_, i) => mockSnap(`d${i}`, { totalOI: i * 1000 })))).toBe(0);
  });

  it('cumulativeAbnormalOI rises when recent OI growth exceeds baseline', async () => {
    const { computeCumulativeAbnormalOI } = await import('@/lib/data/persistence');
    // Baseline: noisy low-magnitude OI changes; tail: large positive jumps.
    // Need real variance in the baseline so the std-dev divisor isn't 0.
    const history = [
      ...Array.from({ length: 25 }, (_, i) =>
        mockSnap(`d${i}`, { totalOI: 100_000 + i * 100 + Math.sin(i * 1.7) * 250 }),
      ),
      ...Array.from({ length: 5 }, (_, i) => mockSnap(`d${25 + i}`, { totalOI: 200_000 + i * 50_000 })),
    ];
    const cum = computeCumulativeAbnormalOI(history);
    expect(cum).toBeGreaterThan(2);
  });
});

describe('persistence — updateAndComputeHistory', () => {
  it('first-ever snapshot has zero netDeltaZ + zero historyDays (persistence is 1 for current day)', async () => {
    const { updateAndComputeHistory } = await import('@/lib/data/persistence');
    const out = await updateAndComputeHistory('NEW', mockSnap('2026-04-25', { netDelta: 5000 }));
    expect(out.netDeltaZ).toBe(0);
    expect(out.historyDays).toBe(0);
    // Current day counts as day 1 of the streak even with no history.
    expect(out.persistenceDays).toBe(1);
  });

  it('20+ days of history produces non-zero netDeltaZ', async () => {
    const { appendSnapshot, updateAndComputeHistory } = await import('@/lib/data/persistence');
    for (let i = 0; i < 25; i++) {
      const d = new Date('2026-01-01');
      d.setDate(d.getDate() + i);
      await appendSnapshot('OLD', mockSnap(d.toISOString().slice(0, 10), { netDelta: 1000 + i * 10 }));
    }
    const out = await updateAndComputeHistory('OLD', mockSnap('2026-02-15', { netDelta: 100_000 }));
    expect(out.historyDays).toBe(25);
    expect(Math.abs(out.netDeltaZ)).toBeGreaterThan(2);
  });
});

function mockSnap(date: string, overrides: Partial<{ netDelta: number; totalOI: number }>) {
  return {
    date,
    netDelta: overrides.netDelta ?? 0,
    callVolume: 0,
    putVolume: 0,
    callOI: 0,
    putOI: 0,
    totalOI: overrides.totalOI ?? 100_000,
    volumeRatio: 1.0,
    price: 100,
    largeContractPremiumUSD: 0,
  };
}
