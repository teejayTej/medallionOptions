'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ScoredTicker } from '@/lib/engine/scoring';
import { TradeDetailModal } from '@/components/TradeDetailModal';
import { ScoreRing, SectionLabel, SignalPill, fmtExp } from '@/components/obsidian/TradesView';

interface TodayResponse {
  scanTime: string;
  vix?: number;
  regime: string | null;
  cacheHit: boolean;
  cacheAgeSec: number;
  staleWhileRevalidate?: boolean;
  counts: { universe: number; scored: number; must_try: number; top_10: number; scanner: number; blocked: number };
  mustTry: ScoredTicker[];
  topTen: ScoredTicker[];
  scanner: ScoredTicker[];
  blocked: Array<{ ticker: string; reason: string }>;
  errors: Array<{ ticker: string; error: string }>;
  notes: string[];
}

type SortKey = 'score' | 'whale' | 'ivr' | 'vrp' | 'volume' | 'edge';
type FilterMode = 'all' | 'long' | 'short';

export default function StocksPage() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ScoredTicker | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('score');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/today?limit=20')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Combine all tiers into one ranked list of actionable option recommendations.
  const allRanked: ScoredTicker[] = useMemo(() => {
    if (!data) return [];
    return [...data.mustTry, ...data.topTen, ...data.scanner];
  }, [data]);

  const filtered = useMemo(() => {
    if (filterMode === 'all') return allRanked;
    return allRanked.filter((s) => {
      const rec = s.score.recommendation;
      if (!rec) return false;
      if (filterMode === 'long') return rec.side === 'BUY';
      if (filterMode === 'short') return rec.side === 'SELL';
      return true;
    });
  }, [allRanked, filterMode]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      switch (sortBy) {
        case 'whale': return b.score.components.whale - a.score.components.whale;
        case 'ivr': return (b.medallion?.signals.ivRank ?? 0) - (a.medallion?.signals.ivRank ?? 0);
        case 'vrp': return (b.medallion?.signals.vrp ?? 0) - (a.medallion?.signals.vrp ?? 0);
        case 'volume': return (b.whale?.volumeRatio ?? 0) - (a.whale?.volumeRatio ?? 0);
        case 'edge': return computeEdge(b) - computeEdge(a);
        default: return b.score.total - a.score.total;
      }
    });
    return copy;
  }, [filtered, sortBy]);

  const top10 = sorted.slice(0, 10);
  const tail = sorted.slice(10);

  return (
    <div style={{ maxWidth: 1440, margin: '0 auto', width: '100%', padding: '28px 24px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 4 }}>
        <h1 className="mono" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.015em', margin: 0 }}>
          Top 10 Options
        </h1>
        <span style={{ fontSize: 12, color: 'var(--text-500)' }}>
          Ranked by composite score · live whale + Medallion · 15-min REST polled
        </span>
        {data?.staleWhileRevalidate && (
          <span className="mono" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--amber-400)', letterSpacing: '0.08em' }}>
            REFRESHING…
          </span>
        )}
      </div>
      <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-500)', letterSpacing: '0.08em', marginBottom: 24 }}>
        {data
          ? `SCANNED ${data.counts.universe} · SCORED ${data.counts.scored} · ` +
            `MUST_TRY ${data.counts.must_try} · TOP_10 ${data.counts.top_10} · ` +
            `SCANNER ${data.counts.scanner} · BLOCKED ${data.counts.blocked}` +
            (data.cacheAgeSec ? ` · CACHE ${data.cacheAgeSec}s OLD` : '')
          : loading ? 'LOADING…' : 'NO DATA'}
      </div>

      {/* Two-column: main table + regime sidebar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16, alignItems: 'start' }}>
        <div>
          {/* Filter toolbar */}
          <div
            className="mono flex items-center"
            style={{
              gap: 8,
              padding: '10px 14px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              background: 'var(--obsidian-800)',
              marginBottom: 12,
              fontSize: 11,
              color: 'var(--text-500)',
              letterSpacing: '0.06em',
            }}
          >
            <span>FILTER:</span>
            {(['all', 'long', 'short'] as const).map((m) => (
              <FilterChip key={m} active={filterMode === m} onClick={() => setFilterMode(m)}>
                {m.toUpperCase()}
              </FilterChip>
            ))}
            <span style={{ marginLeft: 24 }}>SORT:</span>
            {(['score', 'whale', 'ivr', 'vrp', 'volume', 'edge'] as const).map((k) => (
              <FilterChip key={k} active={sortBy === k} onClick={() => setSortBy(k)}>
                {k.toUpperCase()}
              </FilterChip>
            ))}
            <span style={{ marginLeft: 'auto' }}>{sorted.length} ROWS</span>
          </div>

          {/* Main top-10 table */}
          <SectionLabel name="TOP 10" meta={sortLabel(sortBy)} count={top10.length} first />
          {error ? (
            <ErrorBox msg={error} />
          ) : loading && !data ? (
            <LoadingBox />
          ) : top10.length === 0 ? (
            <EmptyBox msg={`No ${filterMode === 'all' ? '' : filterMode + ' '}recommendations match.`} />
          ) : (
            <Top10Table rows={top10} onRowClick={setSelected} />
          )}

          {tail.length > 0 && (
            <>
              <SectionLabel name="REMAINING UNIVERSE" meta="below top 10" count={tail.length} />
              <Top10Table rows={tail} onRowClick={setSelected} startRank={11} dim />
            </>
          )}

          {data && data.errors.length > 0 && (
            <details style={{ marginTop: 18, fontSize: 11 }}>
              <summary
                className="mono"
                style={{
                  cursor: 'pointer',
                  color: 'var(--text-500)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontSize: 10,
                }}
              >
                ERRORS ({data.errors.length})
              </summary>
              <div className="mono" style={{ marginTop: 8, color: 'var(--terra-400)' }}>
                {data.errors.map((e, i) => (
                  <div key={i} style={{ padding: '2px 0' }}>{e.ticker}: {e.error}</div>
                ))}
              </div>
            </details>
          )}

          {data?.notes.length ? (
            <div className="mono" style={{ marginTop: 18, fontSize: 10, color: 'var(--text-500)', letterSpacing: '0.04em' }}>
              {data.notes.map((n, i) => (
                <div key={i} style={{ padding: '2px 0' }}>· {n}</div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Regime sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <RegimeCard data={data} />
          <FlowSummaryCard rows={allRanked} />
          <UniverseFiltersCard />
        </div>
      </div>

      {selected && <TradeDetailModal scored={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Top 10 table (the heart of this page)
// ──────────────────────────────────────────────────────────────────

function Top10Table({
  rows,
  onRowClick,
  startRank = 1,
  dim = false,
}: {
  rows: ScoredTicker[];
  onRowClick: (s: ScoredTicker) => void;
  startRank?: number;
  dim?: boolean;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--obsidian-800)',
        opacity: dim ? 0.85 : 1,
      }}
    >
      <div style={{ overflowX: 'auto' }}>
        <table className="mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              {[
                { k: '#', align: 'left' },
                { k: 'TICKER', align: 'left' },
                { k: 'SPOT', align: 'right' },
                { k: 'SCORE', align: 'right' },
                { k: 'SIGNAL', align: 'left' },
                { k: 'STRIKE', align: 'right' },
                { k: 'EXPIRY', align: 'left' },
                { k: 'DTE', align: 'right' },
                { k: 'Δ', align: 'right' },
                { k: 'LIMIT', align: 'right' },
                { k: 'CTRS', align: 'right' },
                { k: 'CR/DR', align: 'right' },
                { k: 'EDGE', align: 'right' },
                { k: 'IVR', align: 'right' },
              ].map((h) => (
                <th
                  key={h.k}
                  style={{
                    background: 'var(--obsidian-900)',
                    textAlign: h.align as 'left' | 'right',
                    padding: '10px 12px',
                    fontWeight: 500,
                    fontSize: 9.5,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--text-500)',
                    borderBottom: '1px solid var(--border-subtle)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h.k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => <Top10Row key={s.ticker} scored={s} rank={startRank + i} onClick={() => onRowClick(s)} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Top10Row({ scored, rank, onClick }: { scored: ScoredTicker; rank: number; onClick: () => void }) {
  const rec = scored.score.recommendation;
  const cell: React.CSSProperties = {
    padding: '11px 12px',
    borderBottom: '1px solid var(--border-subtle)',
    color: 'var(--text-300)',
    verticalAlign: 'middle',
    whiteSpace: 'nowrap',
  };
  const edge = computeEdge(scored);
  const ivr = scored.medallion?.signals.ivRank ?? null;

  return (
    <tr
      onClick={onClick}
      style={{ cursor: 'pointer' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <td style={{ ...cell, color: 'var(--text-500)', fontSize: 11 }}>
        #{String(rank).padStart(2, '0')}
      </td>
      <td style={{ ...cell, color: 'var(--text-100)', fontWeight: 500 }}>
        <div className="flex items-center gap-2">
          <ScoreRing score={scored.score.total} size={28} stroke={2.5} />
          <span>{scored.ticker}</span>
        </div>
      </td>
      <td style={{ ...cell, textAlign: 'right', color: 'var(--text-100)' }}>
        ${scored.price.toFixed(2)}
      </td>
      <td style={{ ...cell, textAlign: 'right', color: 'var(--text-100)' }}>
        <span
          style={{
            color:
              scored.score.total >= 85 ? 'var(--sage-400)' :
              scored.score.total >= 70 ? 'var(--sage-500)' :
              scored.score.total >= 50 ? 'var(--amber-400)' :
              'var(--terra-400)',
          }}
        >
          {scored.score.total}
        </span>
      </td>
      <td style={cell}>
        <SignalPill rec={rec} size="sm" />
      </td>
      <td style={{ ...cell, textAlign: 'right' }}>
        {rec ? `$${rec.strike}` : '—'}
      </td>
      <td style={{ ...cell, color: 'var(--text-300)' }}>
        {rec ? fmtExp(rec.expiration) : '—'}
      </td>
      <td style={{ ...cell, textAlign: 'right' }}>
        {rec ? `${rec.dte}D` : '—'}
      </td>
      <td style={{ ...cell, textAlign: 'right' }}>
        {rec ? rec.delta.toFixed(2) : '—'}
      </td>
      <td style={{ ...cell, textAlign: 'right', color: 'var(--sage-400)' }}>
        {rec ? `$${rec.limitPrice.toFixed(2)}` : '—'}
      </td>
      <td style={{ ...cell, textAlign: 'right' }}>
        {rec ? rec.contracts : '—'}
      </td>
      <td style={{ ...cell, textAlign: 'right' }}>
        {rec ? `$${Math.abs(rec.limitPrice * 100 * rec.contracts).toFixed(0)}` : '—'}
      </td>
      <td style={{ ...cell, textAlign: 'right' }}>
        <span
          style={{
            color: edge > 0 ? 'var(--sage-400)' : edge < 0 ? 'var(--terra-400)' : 'var(--text-500)',
          }}
        >
          {edge === 0 ? '—' : `${edge >= 0 ? '+' : ''}${edge.toFixed(0)}%`}
        </span>
      </td>
      <td style={{ ...cell, textAlign: 'right' }}>
        {ivr !== null ? `${ivr.toFixed(0)}` : '—'}
      </td>
    </tr>
  );
}

// ──────────────────────────────────────────────────────────────────
// Sidebar cards
// ──────────────────────────────────────────────────────────────────

function RegimeCard({ data }: { data: TodayResponse | null }) {
  return (
    <SidebarCard title="REGIME CONTEXT" right="HMM proxy">
      <div className="flex flex-col gap-2.5">
        <RegimeRow label="LOW VOL · BULL" prob={data?.regime === 'LOW VOL' ? 0.84 : 0.15} color="var(--sage-400)" />
        <RegimeRow label="HIGH VOL · BULL" prob={data?.regime === 'HIGH VOL' ? 0.55 : 0.05} color="var(--text-300)" />
        <RegimeRow label="LOW VOL · BEAR" prob={0.04} color="var(--text-500)" />
        <RegimeRow label="CRISIS" prob={data?.regime === 'CRISIS' ? 0.7 : 0.02} color="var(--terra-400)" />
      </div>
      <div
        style={{
          marginTop: 14,
          padding: '10px 12px',
          background: 'var(--obsidian-900)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 4,
        }}
      >
        <div
          className="mono"
          style={{ fontSize: 9.5, letterSpacing: '0.08em', color: 'var(--text-500)', marginBottom: 4 }}
        >
          CURRENT
        </div>
        <div className="mono" style={{ fontSize: 13, color: 'var(--text-100)', fontWeight: 600, letterSpacing: '0.04em' }}>
          {data?.regime ?? '—'}
        </div>
        {data?.vix && (
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-500)', marginTop: 4 }}>
            VIX <span style={{ color: 'var(--text-300)' }}>{data.vix.toFixed(2)}</span>
          </div>
        )}
      </div>
      <div className="mono" style={{ fontSize: 9, color: 'var(--text-500)', marginTop: 8, opacity: 0.7, letterSpacing: '0.04em' }}>
        Note: regime is computed per-ticker at scan time; the values above are
        an approximation since we don't yet store cross-day regime stability.
      </div>
    </SidebarCard>
  );
}

function RegimeRow({ label, prob, color }: { label: string; prob: number; color: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center mono" style={{ fontSize: 10.5 }}>
        <span style={{ color: 'var(--text-300)', letterSpacing: '0.04em' }}>{label}</span>
        <div style={{ flex: 1 }} />
        <span style={{ color, fontWeight: 600 }}>{(prob * 100).toFixed(1)}%</span>
      </div>
      <div style={{ height: 4, background: 'var(--obsidian-900)', borderRadius: 1, overflow: 'hidden' }}>
        <div style={{ width: `${prob * 100}%`, height: '100%', background: color }} />
      </div>
    </div>
  );
}

function FlowSummaryCard({ rows }: { rows: ScoredTicker[] }) {
  const flowCounts = useMemo(() => {
    const out: Record<string, number> = {};
    rows.forEach((r) => {
      const sig = r.whale?.flowSignal ?? 'NONE';
      out[sig] = (out[sig] ?? 0) + 1;
    });
    return out;
  }, [rows]);

  const cpAvg = useMemo(() => {
    const ratios = rows.map((r) => r.whale?.callPutRatio).filter((x): x is number => x !== undefined);
    if (ratios.length === 0) return null;
    return ratios.reduce((a, b) => a + b, 0) / ratios.length;
  }, [rows]);

  const totalNotional = useMemo(() =>
    rows.reduce((s, r) => s + (r.whale?.totalLargeNotional ?? 0), 0),
  [rows]);

  return (
    <SidebarCard title="FLOW SUMMARY" right={`${rows.length} tickers`}>
      <div className="flex flex-col gap-2 mono" style={{ fontSize: 10.5 }}>
        <SidebarStat label="Avg C/P" value={cpAvg !== null ? cpAvg.toFixed(2) : '—'} tone={cpAvg !== null ? (cpAvg > 1.2 ? 'sage' : cpAvg < 0.8 ? 'terra' : 'neutral') : 'neutral'} />
        <SidebarStat label="Large Notional" value={totalNotional > 0 ? `$${(totalNotional / 1e6).toFixed(1)}M` : '$0'} tone="neutral" />
      </div>
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--text-500)', letterSpacing: '0.08em', marginBottom: 6 }}>
          DOMINANT FLOWS
        </div>
        <div className="flex flex-col gap-1.5">
          {Object.entries(flowCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([sig, n]) => (
              <div key={sig} className="flex items-center mono" style={{ fontSize: 10.5 }}>
                <span style={{ color: 'var(--text-300)', letterSpacing: '0.04em' }}>
                  {sig.replace(/_/g, ' ')}
                </span>
                <div style={{ flex: 1 }} />
                <span style={{ color: 'var(--text-100)' }}>{n}</span>
              </div>
            ))}
        </div>
      </div>
    </SidebarCard>
  );
}

function UniverseFiltersCard() {
  return (
    <SidebarCard title="UNIVERSE FILTERS">
      <div className="flex flex-col gap-2 mono" style={{ fontSize: 10.5 }}>
        <SidebarStat label="Universe size" value="26 tickers" tone="neutral" />
        <SidebarStat label="Min market cap" value="MID ($2B+)" tone="neutral" />
        <SidebarStat label="Min OI" value="100" tone="neutral" />
        <SidebarStat label="DTE band" value="14–60" tone="neutral" />
        <SidebarStat label="Earnings buffer" value="±7d" tone="neutral" />
        <SidebarStat label="IV Rank window" value="20–90" tone="neutral" />
      </div>
    </SidebarCard>
  );
}

function SidebarCard({ title, right, children }: { title: string; right?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--obsidian-800)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        padding: 14,
      }}
    >
      <div
        className="flex items-center mono"
        style={{
          fontSize: 9.5,
          letterSpacing: '0.1em',
          color: 'var(--text-500)',
          marginBottom: 12,
        }}
      >
        <span>{title}</span>
        {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
      </div>
      {children}
    </div>
  );
}

function SidebarStat({ label, value, tone }: { label: string; value: string; tone: 'sage' | 'terra' | 'amber' | 'neutral' }) {
  const color =
    tone === 'sage' ? 'var(--sage-400)' :
    tone === 'terra' ? 'var(--terra-400)' :
    tone === 'amber' ? 'var(--amber-400)' :
    'var(--text-100)';
  return (
    <div className="flex items-center" style={{ fontSize: 10.5 }}>
      <span style={{ color: 'var(--text-300)' }}>{label}</span>
      <div style={{ flex: 1 }} />
      <span style={{ color }}>{value}</span>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="mono"
      style={{
        padding: '4px 10px',
        borderRadius: 4,
        border: '1px solid',
        borderColor: active ? 'var(--border-strong)' : 'var(--border-subtle)',
        color: active ? 'var(--text-100)' : 'var(--text-500)',
        background: active ? 'var(--obsidian-700)' : 'transparent',
        fontSize: 10,
        letterSpacing: '0.08em',
      }}
    >
      {children}
    </button>
  );
}

function LoadingBox() {
  return (
    <div
      style={{
        background: 'var(--obsidian-800)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        padding: 40,
        textAlign: 'center',
        color: 'var(--text-500)',
      }}
    >
      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em' }}>RUNNING SCAN…</div>
      <div className="mono" style={{ fontSize: 10, marginTop: 6, opacity: 0.6 }}>
        First load takes 15-30s; subsequent loads served from cache.
      </div>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div
      style={{
        background: 'var(--obsidian-800)',
        border: '1px solid rgba(235,87,87,0.3)',
        borderRadius: 8,
        padding: 24,
        textAlign: 'center',
        color: 'var(--terra-400)',
        fontSize: 12,
      }}
    >
      Error: {msg}
    </div>
  );
}

function EmptyBox({ msg }: { msg: string }) {
  return (
    <div
      style={{
        background: 'var(--obsidian-800)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        padding: 24,
        textAlign: 'center',
        color: 'var(--text-500)',
        fontSize: 12,
      }}
    >
      {msg}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function sortLabel(k: SortKey): string {
  const map: Record<SortKey, string> = {
    score: 'BY SCORE',
    whale: 'BY WHALE STRENGTH',
    ivr: 'BY IV RANK',
    vrp: 'BY VOLATILITY RISK PREMIUM',
    volume: 'BY VOLUME RATIO',
    edge: 'BY EXPECTED EDGE',
  };
  return map[k];
}

/**
 * Compute "expected edge" % for a recommendation:
 *   for SELL: expected value / max risk
 *   for BUY:  (recent mid - limit) / limit (synthesized; treats winRate × avgWin)
 *
 * Only meaningful as a relative ranker — not annualized return.
 */
function computeEdge(s: ScoredTicker): number {
  const rec = s.score.recommendation;
  if (!rec) return 0;
  const ev = rec.expectedPL.expectedValue;
  const maxRisk = rec.maxLoss;
  if (maxRisk === 0) return 0;
  return (ev / maxRisk) * 100;
}
