// Daily whale-snapshot persistence.
//
// File-per-ticker JSON (data/snapshots/{TICKER}.json). Each file holds an
// array of daily snapshots, newest last. We use this layer to compute the
// V5 history-dependent fields (netDeltaZ, persistenceDays, cumulativeAbnormalOI)
// that previously stubbed to zero because no history was being recorded.
//
// Why JSON-on-disk over SQLite:
//   - 26-50 tickers × 90 days = 2,340-4,500 records max. Linear scans are fine.
//   - No native binary dep (better-sqlite3 needs node-gyp on Windows).
//   - Easy to inspect / git-ignore / wipe.
//
// Atomic-write pattern: write to .tmp, then rename. Each ticker has its own
// file so parallel scans across different tickers don't conflict. Within a
// ticker we sequentially read → mutate → write so the parallel-batch loop
// in whale-scanner.ts is safe.

import { promises as fs } from 'node:fs';
import path from 'node:path';

const SNAPSHOTS_DIR = path.join(process.cwd(), 'data', 'snapshots');
const MAX_HISTORY_DAYS = 120; // hard cap per ticker

export interface DailySnapshot {
  /** ISO YYYY-MM-DD. */
  date: string;
  /** Volume-weighted call delta sum (signed; positive = bullish exposure). */
  netDelta: number;
  callVolume: number;
  putVolume: number;
  callOI: number;
  putOI: number;
  totalOI: number;
  volumeRatio: number;
  price: number;
  /** Sum of (volume × price × 100) for "large" (vol > 30% of OI) contracts. */
  largeContractPremiumUSD: number;
}

async function ensureDir(): Promise<void> {
  try {
    await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
  } catch {
    // already exists
  }
}

function fileForTicker(ticker: string): string {
  // Sanitize: only allow letters, digits, dots, hyphens.
  const safe = ticker.replace(/[^A-Za-z0-9.\-]/g, '_');
  return path.join(SNAPSHOTS_DIR, `${safe}.json`);
}

async function atomicWriteJSON(filepath: string, value: unknown): Promise<void> {
  const tmp = `${filepath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  await fs.writeFile(tmp, JSON.stringify(value), 'utf-8');
  try {
    await fs.rename(tmp, filepath);
  } catch (e) {
    // Cleanup tmp if rename failed.
    try { await fs.unlink(tmp); } catch {}
    throw e;
  }
}

/** Read all snapshots for a ticker. Returns [] if the file doesn't exist. */
export async function readSnapshots(ticker: string): Promise<DailySnapshot[]> {
  await ensureDir();
  try {
    const raw = await fs.readFile(fileForTicker(ticker), 'utf-8');
    const parsed = JSON.parse(raw) as DailySnapshot[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    // Corrupt JSON: log and start fresh rather than crash.
    console.warn(`[persistence] read failed for ${ticker}: ${(err as Error).message}`);
    return [];
  }
}

/** Read recent snapshots for a ticker, ordered oldest → newest. */
export async function readRecentSnapshots(
  ticker: string,
  lookbackDays: number,
): Promise<DailySnapshot[]> {
  const all = await readSnapshots(ticker);
  if (all.length <= lookbackDays) return all;
  return all.slice(-lookbackDays);
}

/**
 * Append today's snapshot. If a snapshot for the same date already exists,
 * it is replaced in place (so reruns within a session don't duplicate).
 * Trims history to MAX_HISTORY_DAYS.
 */
export async function appendSnapshot(ticker: string, snap: DailySnapshot): Promise<void> {
  await ensureDir();
  const existing = await readSnapshots(ticker);
  const filtered = existing.filter((s) => s.date !== snap.date);
  filtered.push(snap);
  // Sort by date asc and trim.
  filtered.sort((a, b) => a.date.localeCompare(b.date));
  const trimmed = filtered.length > MAX_HISTORY_DAYS ? filtered.slice(-MAX_HISTORY_DAYS) : filtered;
  await atomicWriteJSON(fileForTicker(ticker), trimmed);
}

// ──────────────────────────────────────────────────────────────────
// History-derived metrics (the things V5 scoring needs)
// ──────────────────────────────────────────────────────────────────

/** Z-score of current netDelta vs the rolling baseline of the prior days. */
export function computeNetDeltaZScore(
  currentNetDelta: number,
  history: DailySnapshot[],
): number {
  if (history.length < 20) return 0;
  const xs = history.map((h) => h.netDelta);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (currentNetDelta - mean) / std;
}

/**
 * Walk the most recent sessions newest-first; count how many in a row
 * share the sign of currentNetDelta. The current session counts as 1
 * if non-zero; we then walk history newest-first and increment while
 * sign matches.
 */
export function computePersistenceDays(
  currentNetDelta: number,
  history: DailySnapshot[],
): number {
  if (currentNetDelta === 0) return 0;
  const sign = currentNetDelta > 0 ? 1 : -1;
  let count = 1;
  for (let i = history.length - 1; i >= 0; i--) {
    const d = history[i].netDelta;
    if (d === 0) break;
    const s = d > 0 ? 1 : -1;
    if (s !== sign) break;
    count++;
  }
  return count;
}

/**
 * Cumulative abnormal OI: sum of the last 5 daily ΔtotalOI values, each
 * normalized by the 60-day std-dev of daily ΔtotalOI. Returns 0 when
 * history is too short to compute reliably.
 *
 * The intuition: if total OI is growing meaningfully (Z-score > 1) for
 * several days in a row, institutions are accumulating positions —
 * one of the strongest "real money is moving here" tells.
 */
export function computeCumulativeAbnormalOI(history: DailySnapshot[]): number {
  if (history.length < 21) return 0;
  // Daily delta OI for every consecutive pair we have.
  const deltas: number[] = [];
  for (let i = 1; i < history.length; i++) {
    deltas.push(history[i].totalOI - history[i - 1].totalOI);
  }
  if (deltas.length < 20) return 0;
  // Use the LAST 60 deltas (or all available if fewer) to compute std.
  const baseline = deltas.slice(0, Math.max(1, deltas.length - 5));
  if (baseline.length < 10) return 0;
  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const std = Math.sqrt(baseline.reduce((s, x) => s + (x - mean) ** 2, 0) / baseline.length);
  if (std === 0) return 0;
  // Sum the last 5 deltas as Z-scores.
  const last5 = deltas.slice(-5);
  return last5.reduce((s, d) => s + (d - mean) / std, 0);
}

// ──────────────────────────────────────────────────────────────────
// Convenience: one call to update + read derived fields
// ──────────────────────────────────────────────────────────────────

export interface HistoryFields {
  netDeltaZ: number;
  persistenceDays: number;
  cumulativeAbnormalOI: number;
  /** Number of daily snapshots stored (informational). */
  historyDays: number;
}

/**
 * Atomic operation: append today's snapshot and immediately return the
 * V5 history-dependent fields computed against the prior days. The
 * current snapshot is excluded from the baseline so the metrics describe
 * "where today fits relative to the prior history".
 */
export async function updateAndComputeHistory(
  ticker: string,
  snap: DailySnapshot,
): Promise<HistoryFields> {
  // Read existing first so we have prior-day baseline.
  const prior = await readSnapshots(ticker);
  const baseline = prior.filter((s) => s.date !== snap.date);

  await appendSnapshot(ticker, snap);

  return {
    netDeltaZ: computeNetDeltaZScore(snap.netDelta, baseline),
    persistenceDays: computePersistenceDays(snap.netDelta, baseline),
    cumulativeAbnormalOI: computeCumulativeAbnormalOI([...baseline, snap]),
    historyDays: baseline.length,
  };
}

// Internal — exposed for tests so they can reset the snapshot dir.
export const _SNAPSHOTS_DIR = SNAPSHOTS_DIR;
