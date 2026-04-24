'use client';

import type { Tier } from '@/lib/engine/scoring';

export interface ScanEvent {
  timestamp: number;
  ticker: string;
  tier: Tier;
  total: number;
  whaleScore: number;
  ivr: number;
  side: 'BUY' | 'SELL' | null;
  recommendation: string | null;
  blockedReasons: string[];
}

const KEY = 'medallion.scan_events.v1';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_EVENTS = 5000;

function read(): ScanEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ScanEvent[]) : [];
  } catch {
    return [];
  }
}

function write(next: ScanEvent[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
}

export function logScanEvents(events: ScanEvent[]): void {
  if (events.length === 0) return;
  const cutoff = Date.now() - RETENTION_MS;
  const merged = [...events, ...read()].filter((e) => e.timestamp >= cutoff).slice(0, MAX_EVENTS);
  write(merged);
}

export function listScanEvents(): ScanEvent[] {
  return read();
}

export function exportScanEventsJSON(): string {
  return JSON.stringify(read(), null, 2);
}

export function clearScanEvents(): void {
  write([]);
}
