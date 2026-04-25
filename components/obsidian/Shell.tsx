'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Icon, Icons, type IconName } from './Icon';
import { Tokens as T } from './primitives';

interface NavItem {
  href: string;
  icon: IconName;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: 'WORKSPACE',
    items: [
      { href: '/', icon: 'home', label: 'Command Center' },
      { href: '/today', icon: 'chart', label: "Today's Trades" },
      { href: '/stocks', icon: 'sort', label: 'Top 10 Stocks' },
      { href: '/options', icon: 'layers', label: 'Options Lab' },
    ],
  },
  {
    label: 'SIGNAL',
    items: [
      { href: '/arb', icon: 'bolt', label: 'Arb Scanner', disabled: true, disabledReason: 'computed locally — needs ETF NAV / put-call parity engine' },
      { href: '/kalshi', icon: 'target', label: 'Events (Kalshi)', disabled: true, disabledReason: 'needs Kalshi API integration' },
    ],
  },
  {
    label: 'ANALYTICS',
    items: [
      { href: '/risk', icon: 'shield', label: 'Risk Engine' },
      { href: '/positions', icon: 'flame', label: 'Positions' },
      { href: '/analyst', icon: 'spark', label: 'AI Analyst', disabled: true, disabledReason: 'needs LLM provider key' },
    ],
  },
];

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: T.void }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopStrip />
        <main style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>{children}</main>
      </div>
    </div>
  );
}

function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      style={{
        width: 212,
        flexShrink: 0,
        background: T.void,
        borderRight: `1px solid ${T.borderSubtle}`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          height: 56,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 18px',
          borderBottom: `1px solid ${T.borderSubtle}`,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="13.5" fill="none" stroke={T.text1} strokeWidth="1.25" />
          <circle cx="16" cy="16" r="3.6" fill={T.buy} />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', color: T.text1 }}>Medallion</span>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 9, color: T.text4, letterSpacing: '0.04em' }}>v4.5-b</span>
      </div>

      <nav style={{ flex: 1, padding: '14px 8px', display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
        {NAV.map((g) => (
          <div key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ padding: '0 10px 4px', fontSize: 9, letterSpacing: '0.12em', color: T.text4, fontWeight: 500 }}>
              {g.label}
            </div>
            {g.items.map((n) => {
              const active = pathname === n.href || (n.href !== '/' && pathname.startsWith(n.href));
              const inner = (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    height: 30,
                    padding: '0 10px',
                    color: n.disabled ? T.text4 : active ? T.text1 : T.text2,
                    background: active ? T.elevated : 'transparent',
                    borderRadius: 4,
                    cursor: n.disabled ? 'not-allowed' : 'pointer',
                    position: 'relative',
                    fontSize: 12,
                    fontWeight: active ? 500 : 400,
                    letterSpacing: '-0.005em',
                    opacity: n.disabled ? 0.5 : 1,
                  }}
                  title={n.disabledReason}
                >
                  <Icon size={14} stroke={active ? T.text1 : T.text3} sw={1.5}>
                    {Icons[n.icon]}
                  </Icon>
                  <span>{n.label}</span>
                  {n.disabled && (
                    <span style={{ fontSize: 9, color: T.text4, marginLeft: 'auto', letterSpacing: '0.04em' }}>SOON</span>
                  )}
                  {active && (
                    <div style={{ position: 'absolute', left: -8, top: 7, bottom: 7, width: 2, background: T.buy, borderRadius: 2 }} />
                  )}
                </div>
              );
              if (n.disabled) return <div key={n.href}>{inner}</div>;
              return (
                <Link key={n.href} href={n.href} style={{ textDecoration: 'none' }}>
                  {inner}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div style={{ padding: '12px 14px', borderTop: `1px solid ${T.borderSubtle}`, fontSize: 10, color: T.text4 }}>
        <div className="mono">data: polygon · finnhub · fred</div>
        <div className="mono" style={{ marginTop: 2 }}>15m polled (no WS)</div>
      </div>
    </aside>
  );
}

interface MarketStatus {
  market: string;
  serverTime: string;
  exchanges: { nasdaq: string; nyse: string; otc: string };
}

function TopStrip() {
  const [status, setStatus] = useState<MarketStatus | null>(null);
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    let cancelled = false;
    fetch('/api/market-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setStatus(d); })
      .catch(() => {});
    const i = setInterval(() => {
      fetch('/api/market-status')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!cancelled && d) setStatus(d); })
        .catch(() => {});
    }, 60_000);
    const t = setInterval(() => setNow(new Date()), 1_000);
    return () => { cancelled = true; clearInterval(i); clearInterval(t); };
  }, []);

  const statusLabel = status?.market ?? '…';
  const statusColor =
    statusLabel === 'open' ? T.buy :
    statusLabel === 'closed' ? T.text3 :
    statusLabel === 'extended-hours' ? T.arb :
    T.text2;

  return (
    <header
      style={{
        height: 56,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        padding: '0 24px',
        background: T.void,
        borderBottom: `1px solid ${T.borderSubtle}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: T.text1, letterSpacing: '-0.015em' }}>Medallion Platform</span>
        <span style={{ fontSize: 12, color: T.text3 }}>retail quant · live data</span>
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: 3, background: statusColor }} className={statusLabel === 'open' ? 'obs-blink' : ''} />
          <span className="mono" style={{ fontSize: 10.5, color: T.text2, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {statusLabel.replace('-', ' ')}
          </span>
        </div>
        {status && (
          <span className="mono" style={{ fontSize: 10.5, color: T.text3 }}>
            NYSE {status.exchanges.nyse} · NASDAQ {status.exchanges.nasdaq}
          </span>
        )}
        <span className="mono" style={{ fontSize: 11, color: T.text2 }}>
          {now.toLocaleTimeString('en-US', { hour12: false })}
        </span>
      </div>
    </header>
  );
}
