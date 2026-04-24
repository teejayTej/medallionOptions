'use client';

import { useState } from 'react';
import {
  closePosition,
  deletePosition,
  realizedPnL,
  usePositions,
  useHasMounted,
  type Position,
} from '@/lib/store/positions';

export function PositionsTab() {
  const mounted = useHasMounted();
  const positions = usePositions();
  const open = positions.filter((p) => p.status === 'open');
  const closed = positions.filter((p) => p.status === 'closed').slice(0, 50);

  if (!mounted) return null;

  return (
    <div className="space-y-6">
      <PositionSummary open={open} closed={closed} />
      <section>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3 uppercase tracking-wider">
          Open positions ({open.length})
        </h2>
        {open.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded p-8 text-center text-zinc-500 text-sm">
            No open positions. Track from a trade ticket in <span className="text-emerald-400">Today's Trades</span>.
          </div>
        ) : (
          <div className="space-y-2">
            {open.map((p) => (
              <OpenRow key={p.id} position={p} />
            ))}
          </div>
        )}
      </section>

      {closed.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-zinc-300 mb-3 uppercase tracking-wider">
            Recently closed ({closed.length})
          </h2>
          <div className="bg-zinc-900 border border-zinc-800 rounded overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-zinc-950 text-zinc-500 uppercase tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2">Ticker</th>
                  <th className="text-left px-3 py-2">Trade</th>
                  <th className="text-right px-3 py-2">Entry</th>
                  <th className="text-right px-3 py-2">Exit</th>
                  <th className="text-right px-3 py-2">P&L</th>
                  <th className="text-left px-3 py-2">Reason</th>
                  <th className="text-left px-3 py-2">When</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {closed.map((p) => (
                  <ClosedRow key={p.id} position={p} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function PositionSummary({ open, closed }: { open: Position[]; closed: Position[] }) {
  const realized = closed.reduce((sum, p) => sum + (realizedPnL(p) ?? 0), 0);
  const totalDeployed = open.reduce((s, p) => s + p.entryPrice * 100 * p.contracts, 0);
  return (
    <div className="grid grid-cols-3 gap-3">
      <Card label="Open positions" value={String(open.length)} />
      <Card label="Total deployed" value={`$${totalDeployed.toFixed(0)}`} />
      <Card label="Realized P&L (recent)" value={`${realized >= 0 ? '+' : ''}$${realized.toFixed(0)}`} tone={realized >= 0 ? 'good' : 'bad'} />
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-red-400' : 'text-zinc-100';
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded p-4">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{label}</div>
      <div className={`text-xl font-mono font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function OpenRow({ position }: { position: Position }) {
  const [closing, setClosing] = useState(false);
  const [closePrice, setClosePrice] = useState(position.entryPrice.toFixed(2));
  const sideColor = position.side === 'BUY' ? 'text-amber-400' : 'text-emerald-400';
  const dteRemaining = Math.ceil((new Date(position.expiration).getTime() - Date.now()) / 86400000);
  const cutoffPassed = new Date() > new Date(position.exitRules.dteCutoffDate);

  function handleClose(reason: Position['closedReason']) {
    const px = parseFloat(closePrice);
    if (Number.isNaN(px) || px < 0) return;
    closePosition(position.id, px, reason);
    setClosing(false);
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
      <div className="flex items-center gap-3">
        <span className={`px-2 py-0.5 rounded text-xs font-bold ${position.side === 'BUY' ? 'bg-amber-900 text-amber-300' : 'bg-emerald-900 text-emerald-300'}`}>
          {position.side}
        </span>
        <span className="font-mono font-bold">{position.ticker}</span>
        <span className="text-xs font-mono text-zinc-400">
          ${position.strike} {position.strategy.includes('call') ? 'C' : 'P'} · {position.expiration}
        </span>
        <span className="text-xs text-zinc-500">{position.contracts}× @ ${position.entryPrice.toFixed(2)}</span>
        <span className={`text-xs ${cutoffPassed ? 'text-red-400' : dteRemaining <= 21 ? 'text-amber-400' : 'text-zinc-500'}`}>
          {dteRemaining}d
        </span>
        <div className="flex-1" />
        {!closing ? (
          <>
            <button
              onClick={() => setClosing(true)}
              className="text-xs px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded"
            >
              Close
            </button>
            <button
              onClick={() => deletePosition(position.id)}
              className="text-xs text-zinc-600 hover:text-red-400"
              title="Delete (no record)"
            >
              ×
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">Close @</span>
            <input
              type="number"
              step="0.01"
              value={closePrice}
              onChange={(e) => setClosePrice(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs font-mono w-20"
            />
            <button onClick={() => handleClose('manual')} className={`text-xs px-2 py-1 rounded ${sideColor} bg-zinc-800 hover:bg-zinc-700`}>
              ✓ Manual
            </button>
            <button onClick={() => handleClose('profit_target')} className="text-xs px-2 py-1 bg-emerald-900 hover:bg-emerald-800 text-emerald-300 rounded">
              Profit
            </button>
            <button onClick={() => handleClose('stop_loss')} className="text-xs px-2 py-1 bg-red-900 hover:bg-red-800 text-red-300 rounded">
              Stop
            </button>
            <button onClick={() => setClosing(false)} className="text-xs text-zinc-500 hover:text-zinc-300">
              Cancel
            </button>
          </div>
        )}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-zinc-500">
        <span>✓ Profit @ ${position.exitRules.profitTargetPrice.toFixed(2)}</span>
        <span>✗ Stop @ ${position.exitRules.stopLossPrice.toFixed(2)}</span>
        <span>⏰ Cutoff {position.exitRules.dteCutoffDate}</span>
      </div>
    </div>
  );
}

function ClosedRow({ position }: { position: Position }) {
  const pnl = realizedPnL(position);
  return (
    <tr className="border-t border-zinc-800">
      <td className="px-3 py-2 font-mono font-semibold">{position.ticker}</td>
      <td className="px-3 py-2 font-mono text-zinc-400">
        {position.side} ${position.strike}{position.strategy.includes('call') ? 'C' : 'P'} {position.expiration}
      </td>
      <td className="text-right px-3 py-2 font-mono">${position.entryPrice.toFixed(2)}</td>
      <td className="text-right px-3 py-2 font-mono">${position.closedPrice?.toFixed(2)}</td>
      <td className={`text-right px-3 py-2 font-mono font-semibold ${(pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {pnl !== null ? `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)}` : '—'}
      </td>
      <td className="px-3 py-2 text-zinc-500">{position.closedReason?.replace('_', ' ')}</td>
      <td className="px-3 py-2 text-zinc-500">
        {position.closedAt ? new Date(position.closedAt).toLocaleDateString() : '—'}
      </td>
      <td className="px-3 py-2">
        <button
          onClick={() => deletePosition(position.id)}
          className="text-zinc-600 hover:text-red-400 text-xs"
          title="Delete record"
        >
          ×
        </button>
      </td>
    </tr>
  );
}
