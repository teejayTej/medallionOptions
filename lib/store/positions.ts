'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

export interface Position {
  id: string;
  enteredAt: number;
  ticker: string;
  contract: string;
  side: 'BUY' | 'SELL';
  strategy: string;
  strike: number;
  expiration: string;
  entryPrice: number;
  contracts: number;
  exitRules: {
    profitTargetPrice: number;
    stopLossPrice: number;
    dteCutoffDate: string;
  };
  status: 'open' | 'closed';
  closedAt?: number;
  closedPrice?: number;
  closedReason?: 'profit_target' | 'stop_loss' | 'time_stop' | 'manual';
  notes?: string;
}

const KEY = 'medallion.positions.v1';
const listeners = new Set<() => void>();
const EMPTY: Position[] = [];
let cache: Position[] | null = null;

function read(): Position[] {
  if (cache !== null) return cache;
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Position[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: Position[]): void {
  cache = next;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* quota / private mode */
    }
  }
  listeners.forEach((l) => l());
}

export function listPositions(): Position[] {
  return read();
}

export function addPosition(p: Omit<Position, 'id' | 'enteredAt' | 'status'>): Position {
  const full: Position = {
    ...p,
    id: `${p.ticker}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    enteredAt: Date.now(),
    status: 'open',
  };
  write([full, ...read()]);
  return full;
}

export function closePosition(
  id: string,
  closedPrice: number,
  reason: Position['closedReason'] = 'manual',
): void {
  const next = read().map((p) =>
    p.id === id ? { ...p, status: 'closed' as const, closedAt: Date.now(), closedPrice, closedReason: reason } : p,
  );
  write(next);
}

export function deletePosition(id: string): void {
  write(read().filter((p) => p.id !== id));
}

export function usePositions(): Position[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(),
    () => EMPTY,
  );
}

export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

export function realizedPnL(p: Position): number | null {
  if (p.status !== 'closed' || p.closedPrice === undefined) return null;
  const direction = p.side === 'BUY' ? 1 : -1;
  return direction * (p.closedPrice - p.entryPrice) * 100 * p.contracts;
}
