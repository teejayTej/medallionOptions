'use client';

import { useEffect } from 'react';
import type { ScoredTicker } from '@/lib/engine/scoring';
import { addPosition } from '@/lib/store/positions';

export function TradeDetailModal({
  scored,
  onClose,
}: {
  scored: ScoredTicker;
  onClose: () => void;
}) {
  const { score, ticker, price, whale, medallion, reference, earnings } = scored;
  const rec = score.recommendation;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function copySteps() {
    if (!rec) return;
    navigator.clipboard.writeText(rec.robinhoodSteps.join(' → ')).catch(() => {});
  }

  function trackPosition() {
    if (!rec) return;
    addPosition({
      ticker,
      contract: rec.contract,
      side: rec.side,
      strategy: rec.strategy,
      strike: rec.strike,
      expiration: rec.expiration,
      entryPrice: rec.limitPrice,
      contracts: rec.contracts,
      exitRules: {
        profitTargetPrice: rec.exitRules.profitTargetPrice,
        stopLossPrice: rec.exitRules.stopLossPrice,
        dteCutoffDate: rec.exitRules.dteCutoffDate,
      },
    });
    onClose();
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-zinc-900 border border-zinc-800 rounded-lg max-w-2xl w-full my-8 overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-mono font-bold">{ticker}</span>
              <span className="text-sm text-zinc-500">${price.toFixed(2)}</span>
              {reference.name && <span className="text-xs text-zinc-600">· {reference.name}</span>}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              {reference.tier.toUpperCase()} cap
              {reference.marketCap && ` · $${(reference.marketCap / 1e9).toFixed(1)}B`}
              {' · '}{score.tier.replace('_', ' ').toUpperCase()} tier · score {score.total}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {rec ? (
          <>
            <div className="px-5 py-4 border-b border-zinc-800">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Contract</div>
              <code className="block bg-zinc-950 border border-zinc-800 rounded px-3 py-2 font-mono text-sm break-all">
                {rec.contract}
              </code>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-xs">
                <div className="text-zinc-500">Action</div>
                <div className={`text-right font-semibold ${rec.side === 'BUY' ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {rec.side} {rec.strategy.replace('_', ' ').toUpperCase()}
                </div>
                <div className="text-zinc-500">Strike / Expiration</div>
                <div className="text-right font-mono">${rec.strike} · {rec.expiration}</div>
                <div className="text-zinc-500">DTE / Δ</div>
                <div className="text-right font-mono">{rec.dte} · {rec.delta.toFixed(3)}</div>
                <div className="text-zinc-500">Limit Price</div>
                <div className="text-right font-mono text-emerald-400 font-semibold">${rec.limitPrice.toFixed(2)}</div>
                <div className="text-zinc-500">Contracts</div>
                <div className="text-right font-mono">{rec.contracts}</div>
                <div className="text-zinc-500">{rec.side === 'BUY' ? 'Total Debit' : 'Total Credit'}</div>
                <div className="text-right font-mono font-semibold">
                  ${Math.abs(rec.limitPrice * 100 * rec.contracts).toFixed(0)}
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-b border-zinc-800">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Score components</div>
              <div className="space-y-1.5">
                {([
                  ['whale', 'Whale activity', score.components.whale],
                  ['conviction', 'Conviction (net Δ)', score.components.conviction],
                  ['ivEdge', 'IV edge', score.components.ivEdge],
                  ['regime', 'Regime fit', score.components.regime],
                  ['liquidity', 'Liquidity (OI proxy)', score.components.liquidity],
                ] as const).map(([k, label, v]) => (
                  <div key={k} className="flex items-center gap-3 text-xs">
                    <span className="w-32 text-zinc-400">{label}</span>
                    <div className="flex-1 bg-zinc-950 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full bg-emerald-600"
                        style={{ width: `${v}%` }}
                      />
                    </div>
                    <span className="w-10 text-right font-mono text-zinc-300">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-5 py-4 border-b border-zinc-800">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Gates passed</div>
              <div className="space-y-1 text-xs">
                {score.gates.map((g) => (
                  <div key={g.name} className="flex items-center gap-2">
                    <span className={g.passed ? 'text-emerald-400' : 'text-red-400'}>
                      {g.passed ? '✓' : '✗'}
                    </span>
                    <span className="text-zinc-400 uppercase tracking-wider w-20 text-[10px]">{g.name}</span>
                    <span className="text-zinc-300">{g.reason}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-5 py-4 border-b border-zinc-800">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Exit rules</div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-zinc-500 text-[10px] uppercase">Profit target</div>
                  <div className="font-mono text-emerald-400 font-semibold mt-1">${rec.exitRules.profitTargetPrice.toFixed(2)}</div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-zinc-500 text-[10px] uppercase">Stop loss</div>
                  <div className="font-mono text-red-400 font-semibold mt-1">${rec.exitRules.stopLossPrice.toFixed(2)}</div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-zinc-500 text-[10px] uppercase">Time stop</div>
                  <div className="font-mono text-amber-400 font-semibold mt-1">{rec.exitRules.dteCutoffDate}</div>
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-b border-zinc-800">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Reasoning</div>
              <ul className="text-xs text-zinc-300 space-y-1">
                {rec.reasoning.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-emerald-500">·</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="px-5 py-4 border-b border-zinc-800 bg-emerald-950/10">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-wider text-emerald-400">Robinhood execution</div>
                <button onClick={copySteps} className="text-[10px] text-emerald-400 hover:text-emerald-300">
                  Copy steps
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono">
                {rec.robinhoodSteps.map((step, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    <span className="px-2 py-1 bg-zinc-950 border border-zinc-800 rounded text-zinc-300">{step}</span>
                    {i < rec.robinhoodSteps.length - 1 && <span className="text-emerald-700">→</span>}
                  </span>
                ))}
              </div>
            </div>

            <div className="px-5 py-4 flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={trackPosition}
                className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded"
              >
                Track as open position
              </button>
            </div>
          </>
        ) : (
          <div className="px-5 py-8 text-center text-zinc-500 text-sm">
            No trade recommendation. Score components and gates below.
            <div className="mt-4 px-5">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2 text-left">Gates</div>
              <div className="space-y-1 text-xs text-left">
                {score.gates.map((g) => (
                  <div key={g.name} className="flex items-center gap-2">
                    <span className={g.passed ? 'text-emerald-400' : 'text-red-400'}>
                      {g.passed ? '✓' : '✗'}
                    </span>
                    <span className="text-zinc-400 uppercase tracking-wider w-20 text-[10px]">{g.name}</span>
                    <span className="text-zinc-300">{g.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {whale && (
          <div className="px-5 py-3 border-t border-zinc-800 text-[11px] text-zinc-500">
            Whale: vol {whale.volumeRatio.toFixed(1)}× · C/P {whale.callPutRatio.toFixed(2)} · netΔ{' '}
            {whale.netDelta.toFixed(0)} · {whale.flowSignal.replace(/_/g, ' ')}
            {medallion && (
              <>
                {' · '}IVR {medallion.signals.ivRank.toFixed(0)}% · VRP{' '}
                {(medallion.signals.vrp * 100).toFixed(1)}% · regime {medallion.regime.label}
              </>
            )}
            {earnings.earningsDate && (
              <>{' · '}earnings {earnings.earningsDate} ({earnings.daysToEarnings}d)</>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
