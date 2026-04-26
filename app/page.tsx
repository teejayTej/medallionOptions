'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ScoredTicker } from '@/lib/engine/scoring';
import { ActionBadge, Card, Pill, ScoreRing, Tokens as T } from '@/components/obsidian/primitives';
import { usePositions, useHasMounted, type Position } from '@/lib/store/positions';
import type { NewsItem } from '@/lib/data/news';

const TAPE_TICKERS = ['SPY', 'QQQ', 'IWM', 'NVDA', 'AAPL', 'MSFT', 'TSLA', 'AMD', 'META', 'GOOGL', 'AMZN'];

interface QuoteResp {
  current: number;
  changePct: number;
  prevClose: number;
}

export default function CommandCenter() {
  const [tape, setTape] = useState<Array<{ tkr: string; q: QuoteResp | null }>>([]);
  const [today, setToday] = useState<{ mustTry: ScoredTicker[]; topTen: ScoredTicker[]; vix?: number; regime: string | null; cacheHit: boolean; cacheAgeSec: number; staleWhileRevalidate?: boolean; counts: { universe: number; scored: number } } | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loadingTape, setLoadingTape] = useState(true);
  const [todayLoading, setTodayLoading] = useState(true);
  const [todayError, setTodayError] = useState<string | null>(null);
  const positions = usePositions();
  const mounted = useHasMounted();

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      TAPE_TICKERS.map((t) => fetch(`/api/quote?ticker=${t}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)),
    ).then((results) => {
      if (cancelled) return;
      setTape(TAPE_TICKERS.map((tkr, i) => ({ tkr, q: results[i] })));
      setLoadingTape(false);
    });

    // Today's scan — limit=6 for the homepage (we only show 6 opportunities here);
    // reduces cold-start cost. Stale-while-revalidate kicks in if a recent scan
    // exists, so most reloads return instantly.
    setTodayLoading(true);
    fetch('/api/today?limit=6')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => { if (!cancelled && d) setToday(d); })
      .catch((e) => { if (!cancelled) setTodayError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setTodayLoading(false); });

    fetch('/api/news?limit=8').then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled && d?.items) setNews(d.items); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const open = mounted ? positions.filter((p) => p.status === 'open') : [];
  const totalDeployed = open.reduce((s, p) => s + p.entryPrice * 100 * p.contracts, 0);
  const opportunities = today ? [...today.mustTry, ...today.topTen].slice(0, 6) : [];

  return (
    <div style={{ color: T.text1 }}>
      <TickerTape data={tape} loading={loadingTape} />

      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 18 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.015em' }}>Command Center</h1>
          <span style={{ fontSize: 12, color: T.text3 }}>Live overview · whale-driven opportunities · open positions · headlines</span>
          {today && (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {today.vix && <Pill tone="neutral">VIX {today.vix.toFixed(1)}</Pill>}
              {today.regime && <Pill tone="neutral">{today.regime}</Pill>}
              {today.cacheHit && <Pill tone="good">⚡ {today.cacheAgeSec}s cached</Pill>}
              <Pill tone="neutral">scored {today.counts.scored}/{today.counts.universe}</Pill>
            </span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, alignItems: 'start' }}>
          <Card
            title="Top Opportunities"
            right={
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {today?.staleWhileRevalidate && (
                  <span className="mono" style={{ fontSize: 10, color: 'var(--amber-400)', letterSpacing: '0.08em' }}>
                    REFRESHING…
                  </span>
                )}
                <Link href="/today" style={{ fontSize: 10.5, color: T.text3, textDecoration: 'none' }}>OPEN ALL →</Link>
              </div>
            }
            pad={0}
          >
            {todayError ? (
              <Empty msg={`Failed to load scan: ${todayError}`} />
            ) : todayLoading && !today ? (
              <Loader msg="Running first scan — 10–20 seconds. Subsequent loads are instant." />
            ) : !today || opportunities.length === 0 ? (
              <Empty msg="No opportunities found in latest scan." />
            ) : (
              <div>
                {opportunities.map((s, i) => <OpportunityRow key={s.ticker} scored={s} top={i === 0} />)}
              </div>
            )}
          </Card>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card title="Open Positions" right={<Link href="/positions" style={{ fontSize: 10.5, color: T.text3, textDecoration: 'none' }}>VIEW ALL →</Link>} pad={0}>
              {open.length === 0 ? (
                <Empty msg="No open positions." />
              ) : (
                <div>
                  {open.slice(0, 5).map((p) => <PositionRow key={p.id} position={p} />)}
                </div>
              )}
              <div style={{ padding: '10px 14px', borderTop: `1px solid ${T.borderSubtle}`, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.text3 }}>
                <span>{open.length} open</span>
                <span className="mono">deployed ${totalDeployed.toFixed(0)}</span>
              </div>
            </Card>

            <Card title="Market Headlines" pad={0}>
              {news.length === 0 ? (
                <Loader msg="Loading news…" />
              ) : (
                <div>
                  {news.slice(0, 6).map((n) => <NewsRow key={n.id} item={n} />)}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function TickerTape({ data, loading }: { data: Array<{ tkr: string; q: QuoteResp | null }>; loading: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '9px 24px', background: T.surface, borderBottom: `1px solid ${T.borderSubtle}`, overflow: 'hidden', whiteSpace: 'nowrap' }}>
      {loading ? (
        <span className="mono" style={{ fontSize: 10.5, color: T.text3 }}>loading quotes…</span>
      ) : (
        data.map(({ tkr, q }) => (
          <div key={tkr} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="mono" style={{ fontSize: 10.5, color: T.text3, letterSpacing: '0.02em' }}>{tkr}</span>
            <span className="mono" style={{ fontSize: 10.5, color: T.text1 }}>{q ? q.current.toFixed(2) : '—'}</span>
            <span className="mono" style={{ fontSize: 10.5, color: q && q.changePct >= 0 ? T.buy : T.sell }}>
              {q ? `${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%` : ''}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function OpportunityRow({ scored, top }: { scored: ScoredTicker; top: boolean }) {
  const rec = scored.score.recommendation;
  return (
    <Link href="/today" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '22px 40px 1fr auto',
        gap: 12,
        alignItems: 'center',
        padding: '11px 14px',
        borderBottom: `1px solid ${T.borderSubtle}`,
        background: top ? 'linear-gradient(90deg, rgba(0,230,138,0.04), transparent 60%)' : 'transparent',
        cursor: 'pointer',
      }}>
        <span className="mono" style={{ fontSize: 10.5, color: T.text4, letterSpacing: '0.04em' }}>
          {scored.score.tier === 'must_try' ? '★' : '·'}
        </span>
        <ScoreRing score={scored.score.total} size={36} stroke={3} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>{scored.ticker}</span>
            <span className="mono" style={{ fontSize: 10.5, color: T.text3 }}>${scored.price.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {rec ? (
              <>
                <ActionBadge action={`${rec.side} ${rec.strategy.includes('call') ? 'CALL' : 'PUT'}`} size="sm" />
                <span className="mono" style={{ fontSize: 10, color: T.text3 }}>${rec.strike} · {rec.dte}D · ${rec.limitPrice.toFixed(2)}</span>
              </>
            ) : (
              <span style={{ fontSize: 10, color: T.text4 }}>no recommendation</span>
            )}
          </div>
        </div>
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: T.buy }}>
          W{scored.score.components.whale}
        </span>
      </div>
    </Link>
  );
}

function PositionRow({ position }: { position: Position }) {
  const dteRemaining = Math.ceil((new Date(position.expiration).getTime() - Date.now()) / 86400000);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr auto', gap: 10, alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${T.borderSubtle}` }}>
      <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: T.text1 }}>{position.ticker}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 10.5, color: position.side === 'BUY' ? T.arb : T.buy, fontWeight: 500, letterSpacing: '0.02em' }}>
          {position.side} {position.strategy.replace('_', ' ').toUpperCase()}
        </span>
        <span className="mono" style={{ fontSize: 10, color: T.text3 }}>
          ${position.strike}{position.strategy.includes('call') ? 'C' : 'P'} · {position.contracts}× @ ${position.entryPrice.toFixed(2)}
        </span>
      </div>
      <span className="mono" style={{ fontSize: 11, color: dteRemaining <= 21 ? T.arb : T.text3 }}>{dteRemaining}D</span>
    </div>
  );
}

function NewsRow({ item }: { item: NewsItem }) {
  const ago = relative(new Date(item.publishedAt));
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${T.borderSubtle}` }}>
        <div style={{ fontSize: 12, color: T.text1, lineHeight: 1.35, marginBottom: 4 }}>{item.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: T.text4 }}>
          <span>{item.publisher}</span>
          <span>·</span>
          <span>{ago}</span>
          {item.tickers.length > 0 && (
            <span className="mono" style={{ marginLeft: 'auto', color: T.text3 }}>{item.tickers.slice(0, 3).join(' · ')}</span>
          )}
        </div>
      </div>
    </a>
  );
}

function relative(d: Date): string {
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function Loader({ msg }: { msg: string }) {
  return <div style={{ padding: 24, textAlign: 'center', color: T.text3, fontSize: 12 }}>{msg}</div>;
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ padding: 24, textAlign: 'center', color: T.text3, fontSize: 12 }}>{msg}</div>;
}
