'use client';

import { useState, type ReactNode } from 'react';
import type { ScoredTicker, Tier } from '@/lib/engine/scoring';
import type { MedallionRecommendation as TradeRecommendation } from '@/lib/engine/scoring';

// ──────────────────────────────────────────────────────────────────
// Section header
// ──────────────────────────────────────────────────────────────────

export function SectionLabel({
  name,
  meta,
  count,
  first,
}: {
  name: string;
  meta?: string;
  count?: number;
  first?: boolean;
}) {
  return (
    <div
      className="mono flex items-baseline"
      style={{
        gap: 14,
        margin: first ? '8px 0 14px' : '32px 0 14px',
        fontSize: 11,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--text-300)',
      }}
    >
      <span style={{ color: 'var(--text-500)' }}>[</span>
      <span>{name}</span>
      <span style={{ color: 'var(--text-500)' }}>]</span>
      {meta && (
        <span style={{ color: 'var(--text-500)', fontSize: 10, letterSpacing: '0.08em' }}>{meta}</span>
      )}
      <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
      {count !== undefined && (
        <span style={{ color: 'var(--text-500)', fontSize: 10, letterSpacing: '0.08em' }}>
          {count} {count === 1 ? 'pick' : 'picks'}
        </span>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Score ring (SVG circular gauge)
// ──────────────────────────────────────────────────────────────────

export function ScoreRing({ score, size = 54, stroke = 4 }: { score: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const color =
    score >= 85 ? 'var(--sage-400)' :
    score >= 70 ? 'var(--sage-500)' :
    score >= 50 ? 'var(--amber-400)' :
    'var(--terra-400)';

  return (
    <div style={{ width: size, height: size, position: 'relative', flex: `0 0 ${size}px` }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={`${c * pct} ${c}`}
          strokeLinecap="round"
        />
      </svg>
      <div
        className="mono"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size * 0.28,
          fontWeight: 600,
          color: 'var(--text-100)',
        }}
      >
        {score}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Inline sparkline
// ──────────────────────────────────────────────────────────────────

export function Sparkline({
  data,
  width = 240,
  height = 34,
  color,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (data.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const c = color ?? (data[data.length - 1] >= data[0] ? 'var(--sage-400)' : 'var(--terra-400)');
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linePath = `M ${pts.join(' L ')}`;
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <path d={areaPath} fill={c} opacity={0.18} />
      <path d={linePath} className="spark-line" stroke={c} />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────
// Side / signal pills
// ──────────────────────────────────────────────────────────────────

export function SignalPill({ rec, size = 'md' }: { rec: TradeRecommendation | null; size?: 'sm' | 'md' }) {
  const label = rec ? labelForRec(rec) : 'HOLD';
  const color = rec ? colorForStrategy(rec.strategy) : 'var(--text-300)';
  return (
    <span
      className="mono"
      style={{
        fontSize: size === 'sm' ? 10 : 10,
        letterSpacing: '0.12em',
        padding: size === 'sm' ? '2px 6px' : '4px 8px',
        borderRadius: 4,
        border: '1px solid currentColor',
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function labelForRec(rec: TradeRecommendation): string {
  if (rec.strategy === 'long_call') return 'BUY CALL';
  if (rec.strategy === 'long_put') return 'BUY PUT';
  if (rec.strategy === 'short_put') return 'SELL PUT';
  if (rec.strategy === 'short_call') return 'SELL CALL';
  if (rec.strategy === 'iron_condor') return 'IRON CONDOR';
  return 'HOLD';
}

function colorForStrategy(strategy: TradeRecommendation['strategy']): string {
  if (strategy === 'long_call' || strategy === 'short_put') return 'var(--sage-400)';
  if (strategy === 'long_put' || strategy === 'short_call') return 'var(--amber-400)';
  if (strategy === 'iron_condor') return 'var(--blue-400)';
  return 'var(--text-300)';
}

// ──────────────────────────────────────────────────────────────────
// Must-Try card
// ──────────────────────────────────────────────────────────────────

export function MustTryCard({
  scored,
  rank,
  spark,
  onClick,
}: {
  scored: ScoredTicker;
  rank: number;
  spark?: number[];
  onClick: () => void;
}) {
  const rec = scored.score.recommendation;
  const dayChange = scored.medallion?.signals.zscore ?? 0;
  const isUp = dayChange >= 0;

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        borderRadius: 10,
        border: '1px solid var(--border-glow)',
        background:
          'radial-gradient(120% 80% at 0% 0%, rgba(111,207,151,0.08), transparent 50%), ' +
          'radial-gradient(80% 60% at 100% 100%, rgba(111,207,151,0.05), transparent 60%), ' +
          'var(--obsidian-800)',
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        cursor: 'pointer',
        transition: 'transform 200ms cubic-bezier(0.4,0,0.2,1), border-color 200ms cubic-bezier(0.4,0,0.2,1)',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.borderColor = 'rgba(111,207,151,0.55)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = '';
        e.currentTarget.style.borderColor = 'var(--border-glow)';
      }}
    >
      {/* Dot grid background */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          opacity: 0.35,
          pointerEvents: 'none',
          maskImage: 'linear-gradient(180deg, rgba(0,0,0,0.5), transparent)',
        }}
      />

      {/* Top: rank + signal pill */}
      <div className="flex items-start justify-between gap-3" style={{ position: 'relative', zIndex: 1 }}>
        <div className="mono flex items-center gap-1.5" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-500)' }}>
          <span>RANK</span>
          <span style={{ color: 'var(--text-300)' }}>#{String(rank).padStart(2, '0')}</span>
        </div>
        <SignalPill rec={rec} />
      </div>

      {/* Ticker row: score ring, ticker, price */}
      <div className="flex items-center gap-3.5" style={{ position: 'relative', zIndex: 1 }}>
        <ScoreRing score={scored.score.total} size={54} stroke={4} />
        <span className="mono" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '0.02em' }}>
          {scored.ticker}
        </span>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div className="mono" style={{ fontSize: 15, color: 'var(--text-100)' }}>
            ${scored.price.toFixed(2)}
          </div>
          <div className="mono" style={{ fontSize: 11, color: isUp ? 'var(--sage-400)' : 'var(--terra-400)' }}>
            {isUp ? '+' : ''}{dayChange.toFixed(2)}σ
          </div>
        </div>
      </div>

      {/* Sparkline */}
      <div style={{ height: 34, position: 'relative', zIndex: 1 }}>
        {spark && spark.length > 1 ? <Sparkline data={spark} width={300} height={34} /> : <SparkSkeleton />}
      </div>

      {/* Action row */}
      {rec && (
        <div
          className="flex items-center gap-2.5"
          style={{
            background: 'var(--obsidian-900)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            padding: '10px 12px',
            position: 'relative',
            zIndex: 1,
          }}
        >
          <div
            style={{
              width: 3,
              alignSelf: 'stretch',
              borderRadius: 2,
              background: colorForStrategy(rec.strategy),
            }}
          />
          <div className="mono" style={{ fontSize: 13, color: 'var(--text-100)', letterSpacing: '0.01em' }}>
            {labelForRec(rec)} <span style={{ color: 'var(--text-500)' }}>${rec.strike}</span>{' '}
            <span style={{ color: 'var(--text-500)' }}>·</span> {fmtExp(rec.expiration)}
          </div>
          <div className="mono" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-500)', letterSpacing: '0.08em' }}>
            {rec.contracts}× @ ${rec.limitPrice.toFixed(2)} · {rec.dte}D
          </div>
        </div>
      )}

      {/* Foot meta: 3 fields */}
      <div className="grid grid-cols-3 gap-2" style={{ position: 'relative', zIndex: 1 }}>
        <FootMetric k="Whale" v={String(scored.score.components.whale)} first />
        <FootMetric k="Conviction" v={String(scored.score.components.conviction)} />
        <FootMetric k="IV Edge" v={String(scored.score.components.ivEdge)} />
      </div>
    </div>
  );
}

function FootMetric({ k, v, first }: { k: string; v: string; first?: boolean }) {
  return (
    <div
      className="flex flex-col"
      style={{
        gap: 2,
        borderLeft: first ? '0' : '1px solid var(--border-subtle)',
        paddingLeft: first ? 0 : 10,
      }}
    >
      <span className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-500)' }}>{k}</span>
      <span className="mono" style={{ fontSize: 13, color: 'var(--text-100)' }}>{v}</span>
    </div>
  );
}

function SparkSkeleton() {
  return (
    <div
      style={{
        height: 34,
        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent)',
        borderRadius: 4,
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────
// Top 10 card (compact)
// ──────────────────────────────────────────────────────────────────

export function TopTenCard({
  scored,
  rank,
  spark,
  onClick,
}: {
  scored: ScoredTicker;
  rank: number;
  spark?: number[];
  onClick: () => void;
}) {
  const rec = scored.score.recommendation;
  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        background: 'var(--obsidian-800)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        padding: 14,
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 14,
        alignItems: 'center',
        cursor: 'pointer',
        transition: 'border-color 200ms cubic-bezier(0.4,0,0.2,1), background 200ms cubic-bezier(0.4,0,0.2,1)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-strong)';
        e.currentTarget.style.background = 'var(--obsidian-700)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-subtle)';
        e.currentTarget.style.background = 'var(--obsidian-800)';
      }}
    >
      <div className="flex items-center gap-2.5">
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-500)', letterSpacing: '0.1em' }}>
          #{String(rank).padStart(2, '0')}
        </span>
        <ScoreRing score={scored.score.total} size={42} stroke={3} />
      </div>

      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="mono" style={{ fontSize: 15, fontWeight: 600 }}>{scored.ticker}</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-300)' }}>${scored.price.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <SignalPill rec={rec} size="sm" />
          {rec && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-500)' }}>
              ${rec.strike} · {rec.dte}D · ${rec.limitPrice.toFixed(2)}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col items-end gap-1.5">
        {spark && spark.length > 1 && (
          <div style={{ width: 90, height: 22 }}>
            <Sparkline data={spark} width={90} height={22} />
          </div>
        )}
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-500)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          W{scored.score.components.whale} · IVR{scored.medallion?.signals.ivRank.toFixed(0) ?? '—'}
        </span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Scanner table
// ──────────────────────────────────────────────────────────────────

export function ScannerTable({
  rows,
  onRowClick,
}: {
  rows: ScoredTicker[];
  onRowClick: (s: ScoredTicker) => void;
}) {
  const [sortBy, setSortBy] = useState<'score' | 'whale' | 'vrp' | 'volume'>('score');
  const sorted = [...rows].sort((a, b) => {
    if (sortBy === 'whale') return b.score.components.whale - a.score.components.whale;
    if (sortBy === 'vrp') return (b.medallion?.signals.vrp ?? 0) - (a.medallion?.signals.vrp ?? 0);
    if (sortBy === 'volume') return (b.whale?.volumeRatio ?? 0) - (a.whale?.volumeRatio ?? 0);
    return b.score.total - a.score.total;
  });

  return (
    <div
      style={{
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--obsidian-800)',
      }}
    >
      <div
        className="flex items-center mono"
        style={{
          gap: 12,
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: 11,
          color: 'var(--text-500)',
          letterSpacing: '0.06em',
        }}
      >
        {(['score', 'whale', 'vrp', 'volume'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setSortBy(k)}
            className="mono"
            style={{
              padding: '4px 10px',
              borderRadius: 4,
              border: '1px solid var(--border-subtle)',
              color: sortBy === k ? 'var(--text-100)' : 'var(--text-300)',
              background: sortBy === k ? 'var(--obsidian-700)' : 'transparent',
              borderColor: sortBy === k ? 'var(--border-strong)' : 'var(--border-subtle)',
              fontSize: 11,
              letterSpacing: '0.06em',
            }}
          >
            {k.toUpperCase()}
          </button>
        ))}
        <span style={{ marginLeft: 'auto' }}>SORT: {sortBy.toUpperCase()} DESC · {sorted.length} rows</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              {['TICKER', 'SIDE', 'TRADE', 'WHALE', 'IVR', 'VRP', 'V/AVG', 'SCORE'].map((h, i) => (
                <th
                  key={h}
                  style={{
                    background: 'var(--obsidian-800)',
                    textAlign: i >= 3 ? 'right' : 'left',
                    padding: '10px 14px',
                    fontWeight: 500,
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--text-500)',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <ScannerRow key={s.ticker} scored={s} onClick={() => onRowClick(s)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScannerRow({ scored, onClick }: { scored: ScoredTicker; onClick: () => void }) {
  const rec = scored.score.recommendation;
  const cellStyle: React.CSSProperties = {
    padding: '9px 14px',
    borderBottom: '1px solid var(--border-subtle)',
    color: 'var(--text-300)',
    verticalAlign: 'middle',
  };
  return (
    <tr
      onClick={onClick}
      style={{ cursor: 'pointer' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <td style={{ ...cellStyle, color: 'var(--text-100)', fontWeight: 500 }}>{scored.ticker}</td>
      <td style={cellStyle}>
        <SignalPill rec={rec} size="sm" />
      </td>
      <td style={{ ...cellStyle, color: 'var(--text-300)', fontSize: 11 }}>
        {rec ? (
          <>
            ${rec.strike}{rec.strategy.includes('call') ? 'C' : 'P'} · {fmtExp(rec.expiration)} · {rec.contracts}× ${rec.limitPrice.toFixed(2)}
          </>
        ) : (
          <span style={{ color: 'var(--text-500)' }}>—</span>
        )}
      </td>
      <td style={{ ...cellStyle, color: 'var(--text-100)', textAlign: 'right' }}>{scored.score.components.whale}</td>
      <td style={{ ...cellStyle, color: 'var(--text-100)', textAlign: 'right' }}>
        {scored.medallion?.signals.ivRank.toFixed(0) ?? '—'}
      </td>
      <td style={{ ...cellStyle, color: 'var(--text-100)', textAlign: 'right' }}>
        {scored.medallion ? `${(scored.medallion.signals.vrp * 100).toFixed(1)}%` : '—'}
      </td>
      <td style={{ ...cellStyle, color: 'var(--text-100)', textAlign: 'right' }}>
        {scored.whale ? `${scored.whale.volumeRatio.toFixed(1)}×` : '—'}
      </td>
      <td style={{ ...cellStyle, color: 'var(--text-100)', textAlign: 'right' }}>
        <ScoreInlineBar score={scored.score.total} />
      </td>
    </tr>
  );
}

function ScoreInlineBar({ score }: { score: number }) {
  const color =
    score >= 85 ? 'var(--sage-400)' :
    score >= 70 ? 'var(--sage-500)' :
    score >= 50 ? 'var(--amber-400)' :
    'var(--terra-400)';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span style={{ width: 34, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden', display: 'inline-block' }}>
        <span style={{ display: 'block', height: '100%', width: `${score}%`, background: color }} />
      </span>
      <span className="mono" style={{ minWidth: 22, color: 'var(--text-100)' }}>{score}</span>
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────
// Blocked accordion
// ──────────────────────────────────────────────────────────────────

export function BlockedAccordion({ items }: { items: Array<{ ticker: string; reason: string }> }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div
      style={{
        marginTop: 14,
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--obsidian-800)',
      }}
    >
      <div
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between mono"
        style={{ padding: '12px 14px', cursor: 'pointer' }}
      >
        <div className="flex items-center gap-3" style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-300)' }}>
          <span>BLOCKED</span>
          <span style={{ color: 'var(--text-500)' }}>{items.length}</span>
        </div>
        <span
          className="mono"
          style={{
            color: 'var(--text-500)',
            fontSize: 11,
            transform: open ? 'rotate(90deg)' : 'rotate(0)',
            transition: 'transform 200ms',
          }}
        >
          ▶
        </span>
      </div>
      {open && (
        <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {items.map((i, idx) => (
            <div
              key={`${i.ticker}-${idx}`}
              className="grid mono"
              style={{
                gridTemplateColumns: '60px 1fr',
                gap: 14,
                alignItems: 'center',
                padding: '10px 14px',
                borderBottom: idx === items.length - 1 ? '0' : '1px solid var(--border-subtle)',
                fontSize: 12,
              }}
            >
              <span style={{ color: 'var(--text-100)', fontWeight: 500 }}>{i.ticker}</span>
              <span style={{ color: 'var(--text-300)' }}>{i.reason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function fmtExp(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
}

export { fmtExp };

// ──────────────────────────────────────────────────────────────────
// Tier helper for callers
// ──────────────────────────────────────────────────────────────────

export function tierColor(tier: Tier): string {
  if (tier === 'must_try') return 'var(--sage-400)';
  if (tier === 'top_10') return 'var(--sage-500)';
  if (tier === 'scanner') return 'var(--amber-400)';
  return 'var(--text-500)';
}

// ──────────────────────────────────────────────────────────────────
// Section block (matches HTML structure)
// ──────────────────────────────────────────────────────────────────

export function MustTryGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
      {children}
    </div>
  );
}

export function TopTenGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
      {children}
    </div>
  );
}
