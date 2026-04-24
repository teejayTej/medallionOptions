'use client';

import { useEffect, useState } from 'react';
import type { ScoredTicker, Tier } from '@/lib/engine/scoring';
import { TradeDetailModal } from '@/components/TradeDetailModal';
import { PositionsTab } from '@/components/PositionsTab';
import { logScanEvents } from '@/lib/store/telemetry';
import { usePositions, useHasMounted } from '@/lib/store/positions';

interface TodayResponse {
  scanTime: string;
  vix?: number;
  regime: string | null;
  portfolioValue: number;
  cacheHit: boolean;
  cacheAgeSec: number;
  counts: { universe: number; scored: number; must_try: number; top_10: number; scanner: number; blocked: number };
  mustTry: ScoredTicker[];
  topTen: ScoredTicker[];
  scanner: ScoredTicker[];
  blocked: Array<{ ticker: string; reason: string }>;
  errors: Array<{ ticker: string; error: string }>;
  notes: string[];
}

type Tab = 'today' | 'positions';

export default function Home() {
  const [tab, setTab] = useState<Tab>('today');
  const [data, setData] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [universe, setUniverse] = useState('');
  const [portfolio, setPortfolio] = useState(100000);
  const [selected, setSelected] = useState<ScoredTicker | null>(null);

  async function fetchToday(refresh: boolean = false) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('portfolio', String(portfolio));
      if (universe.trim()) params.set('universe', universe.trim());
      if (refresh) params.set('refresh', '1');
      const res = await fetch(`/api/today?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as TodayResponse;
      setData(json);
      logScanEvents([
        ...json.mustTry,
        ...json.topTen,
        ...json.scanner,
      ].map((s) => ({
        timestamp: Date.now(),
        ticker: s.ticker,
        tier: s.score.tier,
        total: s.score.total,
        whaleScore: s.score.components.whale,
        ivr: s.medallion?.signals.ivRank ?? 0,
        side: s.score.recommendation?.side ?? null,
        recommendation: s.score.recommendation
          ? `${s.score.recommendation.side} ${s.score.recommendation.strategy}`
          : null,
        blockedReasons: [],
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <HeaderStrip data={data} portfolio={portfolio} setPortfolio={setPortfolio} />

      <div className="max-w-7xl mx-auto px-6 pt-2">
        <nav className="flex gap-1 border-b border-zinc-800">
          <TabBtn active={tab === 'today'} onClick={() => setTab('today')}>Today's Trades</TabBtn>
          <TabBtn active={tab === 'positions'} onClick={() => setTab('positions')}>Positions</TabBtn>
        </nav>
      </div>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {tab === 'today' && (
          <>
            <ScanControls
              universe={universe}
              setUniverse={setUniverse}
              loading={loading}
              hasData={!!data}
              onScan={() => fetchToday(false)}
              onRefresh={() => fetchToday(true)}
            />
            {error && <div className="text-xs text-red-400 mb-4">Error: {error}</div>}
            {data && <TodayContent data={data} onSelect={setSelected} />}
            {!data && !loading && (
              <div className="text-center text-zinc-500 text-sm py-20">
                Hit <span className="text-emerald-500 font-medium">Run Today's Scan</span> to pull live data.
              </div>
            )}
          </>
        )}
        {tab === 'positions' && <PositionsTab />}
      </main>

      {selected && <TradeDetailModal scored={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-semibold tracking-wider uppercase border-b-2 -mb-px ${
        active ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {children}
    </button>
  );
}

function HeaderStrip({
  data,
  portfolio,
  setPortfolio,
}: {
  data: TodayResponse | null;
  portfolio: number;
  setPortfolio: (n: number) => void;
}) {
  const mounted = useHasMounted();
  const positions = usePositions();
  const open = mounted ? positions.filter((p) => p.status === 'open') : [];
  const deployed = open.reduce((s, p) => s + p.entryPrice * 100 * p.contracts, 0);
  const cash = portfolio - deployed;

  return (
    <header className="border-b border-zinc-800 bg-zinc-900">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Medallion Platform</h1>
          <p className="text-[11px] text-zinc-500">v4.5-minus · whale + Medallion + tiered recommendations</p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono">
          <Pill tone="amber">15m POLLED</Pill>
          {data?.regime && <Pill tone="zinc">{data.regime}</Pill>}
          {data?.vix && <Pill tone="zinc">VIX {data.vix.toFixed(1)}</Pill>}
          {data?.cacheHit && <Pill tone="emerald">⚡ cached {data.cacheAgeSec}s</Pill>}

          <div className="border-l border-zinc-700 pl-3 ml-1 text-zinc-400">
            <label className="flex items-center gap-2">
              <span className="text-zinc-500">PORTFOLIO</span>
              <input
                type="number"
                value={portfolio}
                onChange={(e) => setPortfolio(parseFloat(e.target.value) || 0)}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 w-24 text-zinc-100"
              />
            </label>
          </div>
          <div className="text-zinc-400">
            <span className="text-zinc-500">DEPLOYED</span>{' '}
            <span className="text-zinc-100">${deployed.toFixed(0)}</span>
          </div>
          <div className="text-zinc-400">
            <span className="text-zinc-500">CASH</span>{' '}
            <span className="text-zinc-100">${cash.toFixed(0)}</span>
          </div>
        </div>
      </div>
    </header>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone: 'emerald' | 'amber' | 'red' | 'zinc' }) {
  const colors = {
    emerald: 'bg-emerald-950 text-emerald-400 border-emerald-900',
    amber: 'bg-amber-950 text-amber-400 border-amber-900',
    red: 'bg-red-950 text-red-400 border-red-900',
    zinc: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  };
  return <span className={`px-2 py-0.5 rounded border ${colors[tone]}`}>{children}</span>;
}

function ScanControls({
  universe,
  setUniverse,
  loading,
  hasData,
  onScan,
  onRefresh,
}: {
  universe: string;
  setUniverse: (s: string) => void;
  loading: boolean;
  hasData: boolean;
  onScan: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 mb-6 flex items-end gap-3 flex-wrap">
      <label className="flex flex-col gap-1 text-xs flex-1 min-w-[300px]">
        <span className="text-zinc-400">Universe override (empty = curated 26)</span>
        <input
          type="text"
          value={universe}
          onChange={(e) => setUniverse(e.target.value)}
          placeholder="e.g. AAPL,NVDA,TSLA,SMCI,SPY"
          className="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm font-mono"
        />
      </label>
      <button
        onClick={onScan}
        disabled={loading}
        className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-medium px-5 py-2 rounded text-sm"
      >
        {loading ? 'Scanning…' : "Run Today's Scan"}
      </button>
      {hasData && !loading && (
        <button
          onClick={onRefresh}
          className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium px-4 py-2 rounded text-sm"
          title="Bypass cache"
        >
          ↻ Refresh
        </button>
      )}
    </div>
  );
}

function TodayContent({ data, onSelect }: { data: TodayResponse; onSelect: (s: ScoredTicker) => void }) {
  return (
    <>
      <CountStrip counts={data.counts} />
      <MustTrySection items={data.mustTry} onSelect={onSelect} />
      <TopTenSection items={data.topTen} onSelect={onSelect} />
      <ScannerSection items={data.scanner} onSelect={onSelect} />
      <BlockedSection items={data.blocked} />
      {data.notes.length > 0 && (
        <div className="mt-6 text-[11px] text-zinc-500 space-y-0.5">
          {data.notes.map((n, i) => (
            <div key={i}>· {n}</div>
          ))}
        </div>
      )}
      {data.errors.length > 0 && (
        <details className="mt-3 text-[11px]">
          <summary className="text-zinc-500 cursor-pointer">Errors ({data.errors.length})</summary>
          <div className="mt-2 space-y-0.5 text-red-400 font-mono">
            {data.errors.map((e, i) => (
              <div key={i}>{e.ticker}: {e.error}</div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

function CountStrip({ counts }: { counts: TodayResponse['counts'] }) {
  return (
    <div className="flex gap-4 text-xs text-zinc-400 mb-6">
      <span>Universe: {counts.universe}</span>
      <span>Scored: {counts.scored}</span>
      <span className="text-emerald-400">Must-Try: {counts.must_try}</span>
      <span className="text-emerald-500">Top 10: {counts.top_10}</span>
      <span className="text-amber-400">Scanner: {counts.scanner}</span>
      <span className="text-zinc-500">Blocked: {counts.blocked}</span>
    </div>
  );
}

function tierAccent(tier: Tier): string {
  if (tier === 'must_try') return 'border-emerald-700';
  if (tier === 'top_10') return 'border-emerald-900';
  if (tier === 'scanner') return 'border-amber-900';
  return 'border-zinc-800';
}

function sideClasses(side: 'BUY' | 'SELL' | undefined): { pill: string; text: string; arrow: string } {
  if (side === 'BUY') return { pill: 'bg-amber-900 text-amber-300', text: 'text-amber-400', arrow: '↑ BUY' };
  if (side === 'SELL') return { pill: 'bg-emerald-900 text-emerald-300', text: 'text-emerald-400', arrow: '↓ SELL' };
  return { pill: 'bg-zinc-800 text-zinc-400', text: 'text-zinc-400', arrow: '—' };
}

function MustTrySection({ items, onSelect }: { items: ScoredTicker[]; onSelect: (s: ScoredTicker) => void }) {
  return (
    <section className="mb-8">
      <SectionHeader
        title="Must-Try"
        count={items.length}
        subtitle="Highest conviction · score ≥ 85 · whale ≥ 80"
        accent="text-emerald-400"
      />
      {items.length === 0 ? (
        <EmptyState message="No Must-Try picks. Market doesn't meet the conviction bar — review Top 10 below." />
      ) : (
        <div className="space-y-3">
          {items.map((s) => <MustTryCard key={s.ticker} scored={s} onSelect={onSelect} />)}
        </div>
      )}
    </section>
  );
}

function MustTryCard({ scored, onSelect }: { scored: ScoredTicker; onSelect: (s: ScoredTicker) => void }) {
  const { ticker, price, score } = scored;
  const rec = score.recommendation;
  const cls = sideClasses(rec?.side);

  return (
    <div className={`bg-zinc-900 border-2 ${tierAccent('must_try')} rounded-lg p-5`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-baseline gap-3">
          <span className={`px-2 py-0.5 rounded text-xs font-bold ${cls.pill}`}>{cls.arrow}</span>
          <span className="text-2xl font-mono font-bold">{ticker}</span>
          <span className="font-mono text-zinc-300">${price.toFixed(2)}</span>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Score</div>
          <div className="text-3xl font-mono font-bold text-emerald-400">{score.total}</div>
        </div>
      </div>

      {rec && (
        <div className="bg-zinc-950 border border-zinc-800 rounded p-3 mb-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Recommended trade</div>
          <div className="text-lg font-mono font-semibold mb-1">
            {rec.side === 'SELL' ? 'Sell' : 'Buy'}{' '}
            {rec.strategy.includes('call') ? 'Call' : 'Put'} ${rec.strike}{' '}
            <span className="text-zinc-500">·</span> {rec.expiration}
          </div>
          <div className="text-xs font-mono text-zinc-400 flex gap-3">
            <span>{rec.contracts}× @ ${rec.limitPrice.toFixed(2)}</span>
            <span>Δ {rec.delta.toFixed(3)}</span>
            <span>{rec.dte}DTE</span>
            <span className="text-zinc-600">·</span>
            <span>{rec.side === 'BUY' ? 'Debit' : 'Credit'} ${Math.abs(rec.limitPrice * 100 * rec.contracts).toFixed(0)}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-5 gap-2 mb-3">
        {(['whale', 'conviction', 'ivEdge', 'regime', 'liquidity'] as const).map((k) => (
          <div key={k}>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">{k.replace('Edge', ' Edge')}</div>
            <div className="bg-zinc-950 rounded-full h-1.5 mt-1 overflow-hidden">
              <div className="h-full bg-emerald-600" style={{ width: `${score.components[k]}%` }} />
            </div>
            <div className="text-[10px] font-mono text-zinc-400 mt-0.5">{score.components[k]}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 pt-3 border-t border-zinc-800">
        <div className="text-xs text-zinc-400 truncate">
          {score.reasoning.slice(0, 2).join(' · ')}
        </div>
        <button
          onClick={() => onSelect(scored)}
          className="text-xs px-3 py-1.5 bg-emerald-900 hover:bg-emerald-800 text-emerald-300 rounded font-semibold whitespace-nowrap"
        >
          EXECUTE →
        </button>
      </div>
    </div>
  );
}

function TopTenSection({ items, onSelect }: { items: ScoredTicker[]; onSelect: (s: ScoredTicker) => void }) {
  return (
    <section className="mb-8">
      <SectionHeader title="Top 10" count={items.length} subtitle="Score ≥ 70 · whale ≥ 60 · gates passed" accent="text-emerald-500" />
      {items.length === 0 ? (
        <EmptyState message="Nothing qualified for Top 10." />
      ) : (
        <div className="space-y-2">
          {items.map((s, i) => <TopTenRow key={s.ticker} scored={s} rank={i + 1} onSelect={onSelect} />)}
        </div>
      )}
    </section>
  );
}

function TopTenRow({ scored, rank, onSelect }: { scored: ScoredTicker; rank: number; onSelect: (s: ScoredTicker) => void }) {
  const rec = scored.score.recommendation;
  const cls = sideClasses(rec?.side);
  return (
    <div
      onClick={() => onSelect(scored)}
      className="grid grid-cols-[28px_70px_60px_1fr_auto_60px] gap-3 items-center px-3 py-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded cursor-pointer text-sm"
    >
      <span className="text-xs font-mono text-zinc-500">#{rank}</span>
      <span className={`px-2 py-0.5 rounded text-[10px] font-bold text-center ${cls.pill}`}>{rec?.side ?? '—'}</span>
      <span className="font-mono font-bold">{scored.ticker}</span>
      <span className="text-xs font-mono text-zinc-400 truncate">
        {rec ? (
          <>
            ${rec.strike}{rec.strategy.includes('call') ? 'C' : 'P'} · {rec.expiration} · {rec.contracts}× @ ${rec.limitPrice.toFixed(2)}
          </>
        ) : (
          <span className="text-zinc-600">no recommendation</span>
        )}
      </span>
      <span className="text-xs font-mono text-zinc-500">
        W{scored.score.components.whale} · IVR{scored.medallion?.signals.ivRank.toFixed(0) ?? '—'}
      </span>
      <span className="text-right">
        <span className="font-mono font-bold text-emerald-400">{scored.score.total}</span>
        <span className="text-[10px] text-zinc-500">/100</span>
      </span>
    </div>
  );
}

function ScannerSection({ items, onSelect }: { items: ScoredTicker[]; onSelect: (s: ScoredTicker) => void }) {
  const [sortBy, setSortBy] = useState<'score' | 'whale' | 'vrp' | 'volume'>('score');
  const sorted = [...items].sort((a, b) => {
    if (sortBy === 'score') return b.score.total - a.score.total;
    if (sortBy === 'whale') return b.score.components.whale - a.score.components.whale;
    if (sortBy === 'vrp') return (b.medallion?.signals.vrp ?? 0) - (a.medallion?.signals.vrp ?? 0);
    return (b.whale?.volumeRatio ?? 0) - (a.whale?.volumeRatio ?? 0);
  });

  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between mb-3 pb-2 border-b border-zinc-800">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-400">
            Scanner · Unusual Activity <span className="text-zinc-500 ml-1">· {sorted.length}</span>
          </h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">Score ≥ 50 · activity present but doesn't clear Top 10 bar</p>
        </div>
        <div className="flex gap-1 text-[10px] font-mono uppercase">
          {(['score', 'whale', 'vrp', 'volume'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSortBy(k)}
              className={`px-2 py-1 rounded ${sortBy === k ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      {sorted.length === 0 ? (
        <EmptyState message="No tickers between scanner and top tier." />
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-zinc-950 text-zinc-500 uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2">Ticker</th>
                <th className="text-left px-3 py-2">Side</th>
                <th className="text-left px-3 py-2">Trade</th>
                <th className="text-right px-3 py-2">Whale</th>
                <th className="text-right px-3 py-2">IVR</th>
                <th className="text-right px-3 py-2">VRP</th>
                <th className="text-right px-3 py-2">V/avg</th>
                <th className="text-right px-3 py-2">Score</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => <ScannerRow key={s.ticker} scored={s} onSelect={onSelect} />)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ScannerRow({ scored, onSelect }: { scored: ScoredTicker; onSelect: (s: ScoredTicker) => void }) {
  const rec = scored.score.recommendation;
  const cls = sideClasses(rec?.side);
  return (
    <tr
      onClick={() => onSelect(scored)}
      className="border-t border-zinc-800 hover:bg-zinc-800/30 cursor-pointer"
    >
      <td className="px-3 py-2 font-mono font-semibold">{scored.ticker}</td>
      <td className={`px-3 py-2 text-[10px] font-bold ${cls.text}`}>{rec?.side ?? '—'}</td>
      <td className="px-3 py-2 font-mono text-zinc-400 truncate max-w-xs">
        {rec ? `$${rec.strike}${rec.strategy.includes('call') ? 'C' : 'P'} ${rec.expiration} ${rec.contracts}× @ $${rec.limitPrice.toFixed(2)}` : '—'}
      </td>
      <td className="text-right px-3 py-2 font-mono">{scored.score.components.whale}</td>
      <td className="text-right px-3 py-2 font-mono">{scored.medallion?.signals.ivRank.toFixed(0) ?? '—'}</td>
      <td className="text-right px-3 py-2 font-mono">{scored.medallion ? `${(scored.medallion.signals.vrp * 100).toFixed(1)}%` : '—'}</td>
      <td className="text-right px-3 py-2 font-mono">{scored.whale ? `${scored.whale.volumeRatio.toFixed(1)}×` : '—'}</td>
      <td className="text-right px-3 py-2 font-mono font-bold text-amber-400">{scored.score.total}</td>
    </tr>
  );
}

function BlockedSection({ items }: { items: TodayResponse['blocked'] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <section className="mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left pb-2 border-b border-zinc-800 flex items-center justify-between text-zinc-500 hover:text-zinc-300"
      >
        <span className="text-sm">
          Blocked Signals <span className="text-xs">· {items.length} filtered</span>
        </span>
        <span>{open ? '▼' : '▶'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-1">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-3 text-xs font-mono text-zinc-500 py-1 px-3">
              <span className="text-zinc-300 font-bold w-16">{item.ticker}</span>
              <span className="flex-1">{item.reason}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SectionHeader({ title, count, subtitle, accent }: { title: string; count: number; subtitle?: string; accent: string }) {
  return (
    <div className="flex items-baseline justify-between mb-3 pb-2 border-b border-zinc-800">
      <div>
        <h2 className={`text-sm font-semibold uppercase tracking-wider ${accent}`}>
          {title} <span className="text-zinc-500 ml-1">· {count}</span>
        </h2>
        {subtitle && <p className="text-[11px] text-zinc-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded p-6 text-center text-zinc-500 text-sm">
      {message}
    </div>
  );
}
