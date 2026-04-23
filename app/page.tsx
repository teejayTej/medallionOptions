'use client';

import { useState } from 'react';
import type { TickerAnalysis, TradeTicket } from '@/lib/engine/trade-engine';

interface AnalyzeResponse {
  timestamp: string;
  vix?: number;
  regime: { label: string; targetDelta: number; targetDTE: number } | null;
  counts: { universe: number; analyzed: number; errored: number; withTrades: number };
  errors: Array<{ ticker: string; error: string }>;
  top: TickerAnalysis[];
  allRanked: Array<{
    ticker: string;
    price: number;
    score: number;
    signal: string;
    regime: string;
    trades: number;
    vrp: number;
    ivRank: number;
    zscore: number;
    putGate: boolean;
    callGate: boolean;
    notes: string[];
  }>;
}

const DEFAULT_UNIVERSE = 'AAPL,MSFT,NVDA,GOOGL,AMZN,META,TSLA,SPY,QQQ,AMD';

export default function Home() {
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [universe, setUniverse] = useState(DEFAULT_UNIVERSE);
  const [portfolio, setPortfolio] = useState(100000);
  const [topN, setTopN] = useState(3);

  async function analyze() {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/analyze?portfolio=${portfolio}&top=${topN}&universe=${encodeURIComponent(universe)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as AnalyzeResponse;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Medallion Trade Engine</h1>
            <p className="text-xs text-zinc-500 mt-1">
              Live Polygon · signals → regime → score → gates → trade ticket
            </p>
          </div>
          {data && (
            <div className="text-right text-xs text-zinc-500">
              <div>VIX {data.vix?.toFixed(2) ?? '—'} · Regime {data.regime?.label ?? '—'}</div>
              <div>{new Date(data.timestamp).toLocaleTimeString()}</div>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-3 items-end">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-zinc-400">Universe (comma-separated)</span>
              <input
                type="text"
                value={universe}
                onChange={(e) => setUniverse(e.target.value)}
                className="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm font-mono"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-zinc-400">Portfolio $</span>
              <input
                type="number"
                value={portfolio}
                onChange={(e) => setPortfolio(parseFloat(e.target.value) || 0)}
                className="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm w-32"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-zinc-400">Top N</span>
              <input
                type="number"
                value={topN}
                onChange={(e) => setTopN(parseInt(e.target.value, 10) || 3)}
                className="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm w-20"
              />
            </label>
            <button
              onClick={analyze}
              disabled={loading}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-medium px-5 py-2 rounded text-sm"
            >
              {loading ? 'Analyzing…' : 'Analyze'}
            </button>
          </div>
          {loading && (
            <div className="text-xs text-zinc-500 mt-3">
              Polygon rate limit is ~5 req/min. {universe.split(',').length} tickers ≈{' '}
              {Math.ceil(universe.split(',').length * 25)}s including backoff.
            </div>
          )}
          {error && <div className="text-xs text-red-400 mt-3">Error: {error}</div>}
        </div>

        {data && (
          <>
            <div className="mb-6 flex gap-6 text-xs text-zinc-400">
              <span>Analyzed: {data.counts.analyzed}/{data.counts.universe}</span>
              <span>With trades: {data.counts.withTrades}</span>
              <span>Errored: {data.counts.errored}</span>
            </div>

            <section className="mb-8">
              <h2 className="text-sm font-semibold text-zinc-300 mb-3 uppercase tracking-wider">
                Top {data.top.length} — trade tickets
              </h2>
              {data.top.length === 0 ? (
                <div className="bg-zinc-900 border border-zinc-800 rounded p-6 text-center text-zinc-500 text-sm">
                  No tickers passed entry gates. The engine is telling you to sit on hands. See rankings below.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {data.top.map((t) => (
                    <TradeCard key={t.ticker} analysis={t} />
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="text-sm font-semibold text-zinc-300 mb-3 uppercase tracking-wider">
                All ranked
              </h2>
              <div className="bg-zinc-900 border border-zinc-800 rounded overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-950 text-zinc-500 uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-3 py-2">Ticker</th>
                      <th className="text-right px-3 py-2">Price</th>
                      <th className="text-right px-3 py-2">Score</th>
                      <th className="text-left px-3 py-2">Signal</th>
                      <th className="text-right px-3 py-2">Z</th>
                      <th className="text-right px-3 py-2">VRP</th>
                      <th className="text-right px-3 py-2">IVR</th>
                      <th className="text-center px-3 py-2">Put</th>
                      <th className="text-center px-3 py-2">Call</th>
                      <th className="text-right px-3 py-2">Trades</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.allRanked.map((r) => (
                      <tr key={r.ticker} className="border-t border-zinc-800 hover:bg-zinc-800/30">
                        <td className="px-3 py-2 font-mono font-semibold">{r.ticker}</td>
                        <td className="text-right px-3 py-2 font-mono">${r.price.toFixed(2)}</td>
                        <td className={`text-right px-3 py-2 font-mono font-semibold ${scoreColor(r.score)}`}>
                          {r.score}
                        </td>
                        <td className={`px-3 py-2 font-medium ${signalColor(r.signal)}`}>{r.signal}</td>
                        <td className="text-right px-3 py-2 font-mono">{r.zscore.toFixed(2)}</td>
                        <td className="text-right px-3 py-2 font-mono">{(r.vrp * 100).toFixed(1)}%</td>
                        <td className="text-right px-3 py-2 font-mono">{r.ivRank.toFixed(0)}%</td>
                        <td className="text-center px-3 py-2">{r.putGate ? '✅' : '—'}</td>
                        <td className="text-center px-3 py-2">{r.callGate ? '✅' : '—'}</td>
                        <td className="text-right px-3 py-2 font-mono">{r.trades}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {data.errors.length > 0 && (
              <section className="mt-6">
                <h2 className="text-sm font-semibold text-zinc-300 mb-3 uppercase tracking-wider">
                  Errors ({data.errors.length})
                </h2>
                <div className="bg-zinc-900 border border-red-900/50 rounded p-3 text-xs font-mono space-y-1">
                  {data.errors.map((e) => (
                    <div key={e.ticker} className="text-red-400">
                      <span className="font-semibold">{e.ticker}:</span> {e.error}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {!data && !loading && (
          <div className="text-center text-zinc-500 text-sm py-20">
            Hit <span className="text-emerald-500 font-medium">Analyze</span> to pull live data from Polygon.
          </div>
        )}
      </div>
    </div>
  );
}

function scoreColor(s: number): string {
  if (s >= 78) return 'text-emerald-400';
  if (s >= 62) return 'text-emerald-500';
  if (s >= 40) return 'text-amber-400';
  if (s >= 22) return 'text-orange-400';
  return 'text-red-400';
}

function signalColor(sig: string): string {
  if (sig === 'STRONG BUY') return 'text-emerald-400';
  if (sig === 'BUY') return 'text-emerald-500';
  if (sig === 'HOLD') return 'text-amber-400';
  if (sig === 'AVOID') return 'text-orange-400';
  return 'text-red-400';
}

function TradeCard({ analysis }: { analysis: TickerAnalysis }) {
  const ticket = analysis.trades[0];
  const s = analysis.signals;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-zinc-950 border-b border-zinc-800 flex items-baseline justify-between">
        <div>
          <span className="text-lg font-bold font-mono">{analysis.ticker}</span>
          <span className="text-xs text-zinc-500 ml-2">${analysis.price.toFixed(2)}</span>
        </div>
        <div className="text-right">
          <div className={`text-xs font-semibold ${signalColor(analysis.stockSignal)}`}>
            {analysis.stockSignal}
          </div>
          <div className={`text-xl font-bold font-mono ${scoreColor(analysis.medallionScore)}`}>
            {analysis.medallionScore}
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-zinc-800">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <Stat label="Z-Score" value={s.zscore.toFixed(2)} />
          <Stat label="RSI" value={s.rsi.toFixed(0)} />
          <Stat label="VRP" value={`${(s.vrp * 100).toFixed(1)}%`} />
          <Stat label="IV" value={`${(s.iv * 100).toFixed(1)}%`} />
          <Stat label="RV" value={`${(s.rv * 100).toFixed(1)}%`} />
          <Stat label="IVR" value={`${s.ivRank.toFixed(0)}%`} />
        </div>
      </div>

      {ticket ? <TicketBox ticket={ticket} /> : (
        <div className="px-4 py-3 text-xs text-zinc-500">No trade ticket generated.</div>
      )}

      <div className="px-4 py-3 border-t border-zinc-800 text-xs space-y-1">
        <GateRow label="PUT" gate={analysis.gates.putEntry} />
        <GateRow label="CALL" gate={analysis.gates.callEntry} />
        <GateRow label="IC" gate={analysis.gates.icEntry} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-zinc-500 uppercase tracking-wider text-[10px]">{label}</div>
      <div className="font-mono font-medium">{value}</div>
    </div>
  );
}

function GateRow({ label, gate }: { label: string; gate: { pass: boolean; reasons: string[]; blocks: string[] } }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className={`font-semibold ${gate.pass ? 'text-emerald-400' : 'text-zinc-600'}`}>
          {gate.pass ? '✅' : '❌'} {label}
        </span>
        {!gate.pass && gate.blocks[0] && (
          <span className="text-zinc-500 text-[10px] truncate">{gate.blocks[0]}</span>
        )}
      </div>
    </div>
  );
}

function TicketBox({ ticket }: { ticket: TradeTicket }) {
  const action = ticket.type === 'SELL_PUT' ? 'SELL PUT' : ticket.type === 'SELL_CALL' ? 'SELL CALL' : 'IRON CONDOR';
  const urgencyColor =
    ticket.urgency === 'HIGH' ? 'bg-red-600' : ticket.urgency === 'MEDIUM' ? 'bg-amber-600' : 'bg-zinc-700';

  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs font-bold tracking-wider text-emerald-400">{action}</span>
        <span className={`text-[10px] font-semibold text-white px-2 py-0.5 rounded ${urgencyColor}`}>
          {ticket.urgency}
        </span>
      </div>

      <div className="font-mono text-xs text-zinc-400 mb-3 break-all">{ticket.occSymbol}</div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mb-3">
        <div className="text-zinc-500">Strike / Exp</div>
        <div className="text-right font-mono">${ticket.strike} · {ticket.expiration}</div>
        <div className="text-zinc-500">DTE / Δ</div>
        <div className="text-right font-mono">{ticket.dte} · {ticket.delta.toFixed(3)}</div>
        <div className="text-zinc-500">Limit (STO)</div>
        <div className="text-right font-mono text-emerald-400 font-semibold">${ticket.limitPrice.toFixed(2)}</div>
        <div className="text-zinc-500">Size</div>
        <div className="text-right font-mono">{ticket.contracts} × ${(ticket.estimatedCredit * 100).toFixed(0)}</div>
        <div className="text-zinc-500">Credit total</div>
        <div className="text-right font-mono font-semibold">${ticket.expectedPL.maxProfit.toFixed(0)}</div>
      </div>

      <div className="bg-zinc-950 rounded px-3 py-2 text-xs space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Exit rules (BTC)</div>
        <div className="flex justify-between">
          <span className="text-emerald-400">✓ Profit target</span>
          <span className="font-mono">${ticket.exitRules.profitTargetPrice.toFixed(2)} (50%)</span>
        </div>
        <div className="flex justify-between">
          <span className="text-red-400">✗ Stop loss</span>
          <span className="font-mono">${ticket.exitRules.stopLossPrice.toFixed(2)} (2×)</span>
        </div>
        <div className="flex justify-between">
          <span className="text-amber-400">⏰ Time cutoff</span>
          <span className="font-mono">{ticket.exitRules.dteCutoffDate}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mt-3">
        <div className="text-zinc-500">Max loss</div>
        <div className="text-right font-mono text-red-400">${ticket.maxRisk.toFixed(0)}</div>
        <div className="text-zinc-500">E[PnL]</div>
        <div className="text-right font-mono">
          ${ticket.expectedPL.expectedValue.toFixed(0)}
        </div>
        <div className="text-zinc-500">Win rate</div>
        <div className="text-right font-mono">{(ticket.expectedPL.winRate * 100).toFixed(0)}%</div>
        <div className="text-zinc-500">Breakeven</div>
        <div className="text-right font-mono">${ticket.expectedPL.breakeven.toFixed(2)}</div>
      </div>
    </div>
  );
}
