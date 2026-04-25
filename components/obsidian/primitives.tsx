import type { CSSProperties, ReactNode } from 'react';

const T = {
  void: 'var(--color-obs-void)',
  surface: 'var(--color-obs-surface)',
  elevated: 'var(--color-obs-elevated)',
  borderSubtle: 'var(--color-obs-border-subtle)',
  borderMed: 'var(--color-obs-border-med)',
  text1: 'var(--color-obs-text-1)',
  text2: 'var(--color-obs-text-2)',
  text3: 'var(--color-obs-text-3)',
  text4: 'var(--color-obs-text-4)',
  buy: 'var(--color-obs-buy)',
  sell: 'var(--color-obs-sell)',
  sellCall: 'var(--color-obs-sell-call)',
  ironCondor: 'var(--color-obs-iron-condor)',
  arb: 'var(--color-obs-arb)',
  kalshi: 'var(--color-obs-kalshi)',
};

export function ScoreRing({ score, size = 44, stroke = 4, label }: { score: number; size?: number; stroke?: number; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const color = score >= 80 ? T.buy : score >= 60 ? '#b8e669' : score >= 40 ? T.arb : T.sell;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.borderSubtle} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={`${c * pct} ${c}`} strokeLinecap="round" />
      </svg>
      <div className="mono" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.3, fontWeight: 600, color: T.text1, letterSpacing: '-0.03em' }}>
        {score}
      </div>
      {label && <div style={{ fontSize: 9, color: T.text3, textAlign: 'center', marginTop: 2 }}>{label}</div>}
    </div>
  );
}

export function Sparkline({ data, w = 80, h = 22, color = T.buy, fill = false, strokeW = 1.25 }: { data: number[]; w?: number; h?: number; color?: string; fill?: boolean; strokeW?: number }) {
  if (data.length === 0) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      {fill && <polygon points={`0,${h} ${pts} ${w},${h}`} fill={color} opacity={0.12} />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ACTION_COLORS: Record<string, { bg: string; fg: string; bd: string }> = {
  'SELL PUT': { bg: 'rgba(0,230,138,.12)', fg: T.buy, bd: 'rgba(0,230,138,.35)' },
  'BUY CALL': { bg: 'rgba(0,230,138,.12)', fg: T.buy, bd: 'rgba(0,230,138,.35)' },
  'SELL CALL': { bg: 'rgba(0,194,255,.12)', fg: T.sellCall, bd: 'rgba(0,194,255,.35)' },
  'BUY PUT': { bg: 'rgba(255,77,106,.12)', fg: T.sell, bd: 'rgba(255,77,106,.35)' },
  'IRON CONDOR': { bg: 'rgba(167,139,250,.14)', fg: T.ironCondor, bd: 'rgba(167,139,250,.35)' },
  STRANGLE: { bg: 'rgba(244,114,182,.12)', fg: 'var(--color-obs-strangle)', bd: 'rgba(244,114,182,.35)' },
  ARB: { bg: 'rgba(255,154,60,.12)', fg: T.arb, bd: 'rgba(255,154,60,.35)' },
  KALSHI: { bg: 'rgba(167,139,250,.12)', fg: T.kalshi, bd: 'rgba(167,139,250,.35)' },
  HOLD: { bg: 'rgba(164,180,204,.08)', fg: T.text2, bd: T.borderSubtle },
  'NO TRADE': { bg: 'rgba(164,180,204,.08)', fg: T.text3, bd: T.borderSubtle },
};

export function ActionBadge({ action, size = 'md' }: { action: string; size?: 'sm' | 'md' }) {
  const c = ACTION_COLORS[action] ?? ACTION_COLORS['HOLD'];
  const pad = size === 'sm' ? '2px 6px' : '3px 8px';
  const fs = size === 'sm' ? 9.5 : 10.5;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: pad, fontSize: fs, letterSpacing: '0.06em', fontWeight: 600, color: c.fg, background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 3, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
      {action}
    </span>
  );
}

export function PnL({ v, prefix = '$', size = 13, weight = 500 }: { v: number; prefix?: string; size?: number; weight?: number }) {
  const pos = v >= 0;
  const color = pos ? T.buy : T.sell;
  const abs = Math.abs(v);
  const fmt = abs >= 1000 ? abs.toLocaleString(undefined, { maximumFractionDigits: 2 }) : abs.toFixed(2);
  return (
    <span className="mono" style={{ color, fontSize: size, fontWeight: weight }}>
      {pos ? '+' : '−'}{prefix}{fmt}
    </span>
  );
}

export function HBar({ value, max = 1, color = T.buy, w = 80, h = 6, label }: { value: number; max?: number; color?: string; w?: number; h?: number; label?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: w, height: h, background: T.borderSubtle, borderRadius: 1, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, (value / max) * 100)}%`, height: '100%', background: color }} />
      </div>
      {label && <span className="mono" style={{ fontSize: 10, color: T.text2 }}>{label}</span>}
    </div>
  );
}

export function Card({
  title,
  right,
  pad = 14,
  children,
  style,
}: {
  title?: string;
  right?: ReactNode;
  pad?: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.borderSubtle}`, borderRadius: 6, display: 'flex', flexDirection: 'column', minHeight: 0, ...style }}>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${T.borderSubtle}` }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: T.text2, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{title}</span>
          <div style={{ flex: 1 }} />
          {right}
        </div>
      )}
      <div style={{ padding: pad, flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'bad' | 'warn' | 'neutral' | 'info' }) {
  const colors: Record<string, { bg: string; fg: string; bd: string }> = {
    good: { bg: 'rgba(0,230,138,.10)', fg: T.buy, bd: 'rgba(0,230,138,.30)' },
    bad: { bg: 'rgba(255,77,106,.10)', fg: T.sell, bd: 'rgba(255,77,106,.30)' },
    warn: { bg: 'rgba(255,154,60,.10)', fg: T.arb, bd: 'rgba(255,154,60,.30)' },
    info: { bg: 'rgba(0,194,255,.10)', fg: T.sellCall, bd: 'rgba(0,194,255,.30)' },
    neutral: { bg: T.elevated, fg: T.text2, bd: T.borderSubtle },
  };
  const c = colors[tone];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 10, fontWeight: 500, letterSpacing: '0.04em', color: c.fg, background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 3, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

export const Tokens = T;
