'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { usePositions, useHasMounted } from '@/lib/store/positions';

interface NavItem {
  href: string;
  num: string;
  label: string;
  short?: string;
  disabled?: boolean;
  disabledReason?: string;
}

const PRIMARY_NAV: NavItem[] = [
  { href: '/today', num: '01', label: "Today's Trades", short: 'Trades' },
  { href: '/positions', num: '02', label: 'Positions', short: 'Positions' },
  { href: '/analyst', num: '03', label: 'AI Analyst', short: 'AI', disabled: true, disabledReason: 'Needs LLM provider key' },
];

const SECONDARY_NAV: NavItem[] = [
  { href: '/', num: '00', label: 'Command Center' },
  { href: '/stocks', num: '04', label: 'Top 10 Stocks', disabled: true, disabledReason: 'Page not yet built; for now use Today\'s Trades' },
  { href: '/options', num: '05', label: 'Options Lab', disabled: true, disabledReason: 'V5.2 dashboard surfacing' },
  { href: '/risk', num: '06', label: 'Risk Engine', disabled: true, disabledReason: 'V5.2 dashboard surfacing' },
];

interface MarketStatus {
  market?: string;
  serverTime?: string;
  exchanges?: { nasdaq?: string; nyse?: string; otc?: string };
}

interface QuoteResp {
  current: number;
  changePct: number;
}

const TAPE_TICKERS = [
  'SPY', 'QQQ', 'IWM', 'NVDA', 'AAPL', 'MSFT', 'GOOG', 'AMZN', 'TSLA', 'META', 'AMD', 'NFLX', 'COIN', 'AVGO', 'ORCL',
];

interface SourceState {
  name: string;
  status: 'ok' | 'warn' | 'dead';
  detail?: string;
}

export function Shell({ children }: { children: ReactNode }) {
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);
  const [tapeQuotes, setTapeQuotes] = useState<Map<string, QuoteResp>>(new Map());
  const [vix, setVix] = useState<number | null>(null);
  const [sources, setSources] = useState<SourceState[]>([
    { name: 'POLYGON', status: 'ok' },
    { name: 'FINNHUB', status: 'ok' },
    { name: 'FRED', status: 'ok' },
    { name: 'ANTHROPIC', status: 'dead', detail: 'not connected' },
    { name: 'ALPACA', status: 'dead', detail: 'not connected' },
  ]);

  const positions = usePositions();
  const mounted = useHasMounted();

  useEffect(() => {
    let cancelled = false;
    const loadStatus = () => {
      fetch('/api/market-status').then((r) => (r.ok ? r.json() : null)).then((d) => {
        if (cancelled) return;
        if (d) {
          setMarketStatus(d);
          setSources((prev) => prev.map((s) => (s.name === 'POLYGON' ? { ...s, status: 'ok' } : s)));
        } else {
          setSources((prev) => prev.map((s) => (s.name === 'POLYGON' ? { ...s, status: 'warn' } : s)));
        }
      }).catch(() => {});
    };
    const loadVIX = () => {
      fetch('/api/vix').then((r) => (r.ok ? r.json() : null)).then((d) => {
        if (cancelled || !d) return;
        if (typeof d.value === 'number') setVix(d.value);
      }).catch(() => {});
    };
    const loadTape = () => {
      Promise.all(TAPE_TICKERS.map((t) =>
        fetch(`/api/quote?ticker=${t}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      )).then((qs) => {
        if (cancelled) return;
        const map = new Map<string, QuoteResp>();
        TAPE_TICKERS.forEach((t, i) => { if (qs[i]) map.set(t, qs[i]); });
        setTapeQuotes(map);
      });
    };

    loadStatus();
    loadTape();
    loadVIX();
    const i = setInterval(loadStatus, 60_000);
    const j = setInterval(loadTape, 60_000);
    return () => { cancelled = true; clearInterval(i); clearInterval(j); };
  }, []);

  const open = mounted ? positions.filter((p) => p.status === 'open') : [];
  const deployed = open.reduce((s, p) => s + p.entryPrice * 100 * p.contracts, 0);

  const marketLabel = marketStatus?.market ?? '…';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--obsidian-950)' }}>
      <Header
        marketLabel={marketLabel}
        deployed={deployed}
        vix={vix}
      />
      <Tape quotes={tapeQuotes} tickers={TAPE_TICKERS} />
      <SourcesStrip sources={sources} />
      <main className="flex-1 min-h-0 overflow-auto">{children}</main>
    </div>
  );
}

function Header({ marketLabel, deployed, vix }: { marketLabel: string; deployed: number; vix: number | null }) {
  const pathname = usePathname();
  const onPrimary = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href));
  const dataIsLive = marketLabel === 'open' || marketLabel === 'extended-hours';

  return (
    <header
      className="sticky top-0 z-50"
      style={{
        background: 'var(--obsidian-900)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <div
        className="flex items-center justify-between gap-6"
        style={{ padding: '0 24px', height: 54 }}
      >
        {/* Brand + tabs */}
        <div className="flex items-center gap-3">
          <BrandMark />
          <div
            className="mono"
            style={{ fontSize: 13, letterSpacing: '0.04em', fontWeight: 600, color: 'var(--text-100)' }}
          >
            MEDALLION<span style={{ color: 'var(--sage-400)' }}>.</span>
          </div>
          <nav className="flex items-center gap-0.5 ml-2">
            {PRIMARY_NAV.map((n) => (
              <TabButton key={n.href} item={n} active={onPrimary(n.href)} />
            ))}
          </nav>
        </div>

        {/* Status pills */}
        <div className="flex items-center gap-1.5 mono" style={{ fontSize: 11, letterSpacing: '0.04em' }}>
          {vix !== null && <Pill label="VIX" val={vix.toFixed(2)} />}
          <Pill label="DEPLOY" val={`$${(deployed / 1000).toFixed(0)}K`} />
          <LiveDotPill live={dataIsLive} />
        </div>
      </div>

      {/* Secondary nav (numbered) */}
      <div
        className="flex items-center"
        style={{
          padding: '0 24px',
          borderTop: '1px solid var(--border-subtle)',
          background: 'var(--obsidian-950)',
        }}
      >
        {SECONDARY_NAV.map((n) => (
          <SecondaryLink key={n.href} item={n} active={onPrimary(n.href)} />
        ))}
      </div>
    </header>
  );
}

function BrandMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect x="1" y="1" width="20" height="20" rx="4" stroke="var(--text-100)" strokeWidth="1.2" />
      <path
        d="M5 14 L9 8 L13 12 L17 6"
        stroke="var(--sage-400)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="17" cy="6" r="1.6" fill="var(--sage-400)" />
    </svg>
  );
}

function TabButton({ item, active }: { item: NavItem; active: boolean }) {
  const baseStyle = {
    fontSize: 11,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    padding: '8px 12px',
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    transition: 'color 150ms ease, background 150ms ease',
    color: active ? 'var(--text-100)' : 'var(--text-500)',
    background: active ? 'var(--obsidian-800)' : 'transparent',
    cursor: item.disabled ? 'not-allowed' : 'pointer',
    opacity: item.disabled ? 0.45 : 1,
  };
  const numColor = active ? 'var(--sage-400)' : 'var(--text-500)';
  const inner = (
    <button className="mono" style={baseStyle} title={item.disabledReason}>
      <span style={{ color: numColor, fontSize: 10 }}>{item.num}</span>
      <span>{item.label}</span>
    </button>
  );
  if (item.disabled) return inner;
  return (
    <Link href={item.href} style={{ textDecoration: 'none' }}>
      {inner}
    </Link>
  );
}

function SecondaryLink({ item, active }: { item: NavItem; active: boolean }) {
  const inner = (
    <span
      className="mono"
      title={item.disabledReason}
      style={{
        fontSize: 10,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        padding: '8px 14px',
        color: active ? 'var(--text-300)' : 'var(--text-500)',
        opacity: item.disabled ? 0.4 : 1,
        cursor: item.disabled ? 'not-allowed' : 'pointer',
        borderBottom: active ? '1px solid var(--sage-400)' : '1px solid transparent',
        marginBottom: -1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span style={{ color: active ? 'var(--sage-400)' : 'var(--text-500)' }}>{item.num}</span>
      <span>{item.label}</span>
    </span>
  );
  if (item.disabled) return inner;
  return (
    <Link href={item.href} style={{ textDecoration: 'none' }}>
      {inner}
    </Link>
  );
}

function Pill({ label, val, valColor }: { label: string; val: string; valColor?: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 9px',
        border: '1px solid var(--border-subtle)',
        borderRadius: 4,
        background: 'var(--obsidian-800)',
        color: 'var(--text-300)',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: 'var(--text-500)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{ color: valColor ?? 'var(--text-100)' }}>{val}</span>
    </span>
  );
}

function LiveDotPill({ live }: { live: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 9px',
        border: `1px solid ${live ? 'rgba(111,207,151,0.25)' : 'var(--border-subtle)'}`,
        borderRadius: 4,
        background: 'var(--obsidian-800)',
      }}
      title={live ? '15-min delayed REST polling' : 'Market closed'}
    >
      <span
        className={live ? 'anim-pulse' : ''}
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          background: live ? 'var(--sage-400)' : 'var(--text-500)',
        }}
      />
      <span style={{ color: live ? 'var(--sage-400)' : 'var(--text-500)' }}>
        {live ? 'POLLED 15M' : 'CLOSED'}
      </span>
    </span>
  );
}

function Tape({ quotes, tickers }: { quotes: Map<string, QuoteResp>; tickers: string[] }) {
  // Render tickers twice for seamless loop
  const items = [...tickers, ...tickers];
  return (
    <div
      className="overflow-hidden flex items-center relative"
      style={{
        height: 28,
        background: 'var(--obsidian-900)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <div
        className="anim-tape mono"
        style={{
          display: 'flex',
          gap: 34,
          whiteSpace: 'nowrap',
          fontSize: 11,
          letterSpacing: '0.04em',
          color: 'var(--text-300)',
          paddingLeft: 24,
        }}
      >
        {items.map((t, i) => {
          const q = quotes.get(t);
          if (!q) {
            return (
              <span key={`${t}-${i}`} style={{ color: 'var(--text-500)' }}>
                {t} —
              </span>
            );
          }
          const up = q.changePct >= 0;
          return (
            <span key={`${t}-${i}`} style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: 'var(--text-100)' }}>{t}</span>
              <span>{q.current.toFixed(2)}</span>
              <span style={{ color: up ? 'var(--sage-400)' : 'var(--terra-400)' }}>
                {up ? '+' : ''}{q.changePct.toFixed(2)}%
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function SourcesStrip({ sources }: { sources: SourceState[] }) {
  const [now, setNow] = useState<string>('');
  useEffect(() => {
    const update = () => setNow(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
    update();
    const i = setInterval(update, 1000);
    return () => clearInterval(i);
  }, []);
  return (
    <div
      className="flex items-center gap-4 mono"
      style={{
        padding: '8px 24px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--obsidian-950)',
        fontSize: 10,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--text-500)',
      }}
    >
      <span style={{ opacity: 0.6 }}>SOURCES</span>
      {sources.map((s) => (
        <span
          key={s.name}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: s.status === 'dead' ? 'var(--terra-400)' : s.status === 'warn' ? 'var(--amber-400)' : 'var(--text-300)',
            opacity: s.status === 'dead' ? 0.55 : 0.85,
          }}
          title={s.detail}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              background: s.status === 'dead' ? 'var(--terra-400)' : s.status === 'warn' ? 'var(--amber-400)' : 'var(--sage-400)',
            }}
          />
          {s.name}
        </span>
      ))}
      <span style={{ marginLeft: 'auto' }}>SYNC {now}</span>
    </div>
  );
}
