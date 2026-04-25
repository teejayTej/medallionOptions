'use client';

import { useState } from 'react';
import type { ScoredTicker } from '@/lib/engine/scoring';
import { TradeDetailModal } from '@/components/TradeDetailModal';
import { logScanEvents } from '@/lib/store/telemetry';
import { ActionBadge, Card, Pill, ScoreRing, Tokens as T } from '@/components/obsidian/primitives';

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

function actionLabel(rec: ScoredTicker['score']['recommendation']): string {
  if (!rec) return 'NO TRADE';
  const cp = rec.strategy.includes('call') ? 'CALL' : 'PUT';
  return `${rec.side} ${cp}`;
}

export default function TodayPage() {
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
      const res = await fetch(`/api/today?${params}`);
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
    <div style={{ padding: 24, color: T.text1 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.015em', color: T.text1 }}>Today's Trades</h1>
        <span style={{ fontSize: 12, color: T.text3 }}>Whale + Medallion → tiered recommendations</span>
        {data && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {data.vix && <Pill tone="neutral">VIX {data.vix.toFixed(1)}</Pill>}
            {data.regime && <Pill tone="neutral">{data.regime}</Pill>}
            {data.cacheHit && <Pill tone="good">⚡ cached {data.cacheAgeSec}s</Pill>}
          </span>
        )}
      </div>

      <Card style={{ marginBottom: 18 }} pad={14}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: T.text3, flex: 1, minWidth: 280 }}>
            <span>UNIVERSE OVERRIDE (empty = curated 26)</span>
            <input
              type="text"
              value={universe}
              onChange={(e) => setUniverse(e.target.value)}
              placeholder="AAPL,NVDA,TSLA,SPY"
              className="mono"
              style={{ background: T.void, border: `1px solid ${T.borderMed}`, borderRadius: 4, padding: '8px 10px', fontSize: 12, color: T.text1 }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: T.text3 }}>
            <span>PORTFOLIO $</span>
            <input
              type="number"
              value={portfolio}
              onChange={(e) => setPortfolio(parseFloat(e.target.value) || 0)}
              className="mono"
              style={{ background: T.void, border: `1px solid ${T.borderMed}`, borderRadius: 4, padding: '8px 10px', fontSize: 12, color: T.text1, width: 110 }}
            />
          </label>
          <button
            onClick={() => fetchToday(false)}
            disabled={loading}
            style={{ background: loading ? T.elevated : T.buy, color: loading ? T.text3 : T.void, fontWeight: 600, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '9px 16px', border: 'none', borderRadius: 4, cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            {loading ? 'SCANNING…' : 'RUN SCAN'}
          </button>
          {data && !loading && (
            <button
              onClick={() => fetchToday(true)}
              style={{ background: T.elevated, color: T.text2, fontSize: 12, padding: '9px 14px', border: `1px solid ${T.borderMed}`, borderRadius: 4, cursor: 'pointer' }}
            >
              ↻ REFRESH
            </button>
          )}
        </div>
        {error && <div style={{ marginTop: 10, color: T.sell, fontSize: 11 }}>Error: {error}</div>}
      </Card>

      {!data && !loading && (
        <div style={{ textAlign: 'center', padding: 60, color: T.text3, fontSize: 13 }}>
          Hit <span style={{ color: T.buy, fontWeight: 600 }}>RUN SCAN</span> to pull live data.
        </div>
      )}

      {data && (
        <>
          <div style={{ display: 'flex', gap: 18, fontSize: 11, color: T.text3, marginBottom: 18, fontFamily: 'inherit' }}>
            <span>Universe {data.counts.universe}</span>
            <span>Scored {data.counts.scored}</span>
            <span style={{ color: T.buy }}>Must-Try {data.counts.must_try}</span>
            <span style={{ color: '#b8e669' }}>Top 10 {data.counts.top_10}</span>
            <span style={{ color: T.arb }}>Scanner {data.counts.scanner}</span>
            <span>Blocked {data.counts.blocked}</span>
          </div>

          <Section title="Must-Try" subtitle="Score ≥ 85 · whale ≥ 80" accent={T.buy} count={data.mustTry.length}>
            {data.mustTry.length === 0 ? (
              <Empty msg="No Must-Try picks today." />
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {data.mustTry.map((s) => <MustTryCard key={s.ticker} scored={s} onSelect={setSelected} />)}
              </div>
            )}
          </Section>

          <Section title="Top 10" subtitle="Score ≥ 70 · whale ≥ 60" accent="#b8e669" count={data.topTen.length}>
            {data.topTen.length === 0 ? (
              <Empty msg="No Top 10 picks." />
            ) : (
              <Card pad={0}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }} className="mono">
                  <thead>
                    <tr style={{ background: T.void, borderBottom: `1px solid ${T.borderSubtle}` }}>
                      {['#', 'TKR', 'TRADE', 'STRIKE', 'EXP', 'CR', 'WHALE', 'IVR', 'SCORE'].map((h, i) => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: i >= 5 ? 'right' : 'left', fontSize: 9.5, color: T.text3, letterSpacing: '0.08em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.topTen.map((s, i) => <TopTenRow key={s.ticker} scored={s} rank={i + 1} onSelect={setSelected} />)}
                  </tbody>
                </table>
              </Card>
            )}
          </Section>

          <Section title="Scanner" subtitle="Score ≥ 50" accent={T.arb} count={data.scanner.length}>
            {data.scanner.length === 0 ? (
              <Empty msg="No scanner-tier signals." />
            ) : (
              <Card pad={0}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }} className="mono">
                  <thead>
                    <tr style={{ background: T.void, borderBottom: `1px solid ${T.borderSubtle}` }}>
                      {['TKR', 'SIDE', 'TRADE', 'WHALE', 'IVR', 'VRP', 'V/AVG', 'SCORE'].map((h, i) => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: i >= 3 ? 'right' : 'left', fontSize: 9.5, color: T.text3, letterSpacing: '0.08em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.scanner.map((s) => <ScannerRow key={s.ticker} scored={s} onSelect={setSelected} />)}
                  </tbody>
                </table>
              </Card>
            )}
          </Section>

          {data.blocked.length > 0 && (
            <BlockedSection items={data.blocked} />
          )}

          {data.notes.length > 0 && (
            <div style={{ marginTop: 24, fontSize: 10.5, color: T.text4, fontFamily: 'inherit' }}>
              {data.notes.map((n, i) => <div key={i}>· {n}</div>)}
            </div>
          )}
        </>
      )}

      {selected && <TradeDetailModal scored={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Section({ title, subtitle, accent, count, children }: { title: string; subtitle: string; accent: string; count: number; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${T.borderSubtle}` }}>
        <h2 style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', color: accent, textTransform: 'uppercase' }}>{title}</h2>
        <span className="mono" style={{ fontSize: 11, color: T.text4 }}>· {count}</span>
        <span style={{ fontSize: 11, color: T.text3, marginLeft: 8 }}>{subtitle}</span>
      </div>
      {children}
    </section>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <Card pad={20}>
      <div style={{ textAlign: 'center', color: T.text3, fontSize: 12 }}>{msg}</div>
    </Card>
  );
}

function MustTryCard({ scored, onSelect }: { scored: ScoredTicker; onSelect: (s: ScoredTicker) => void }) {
  const rec = scored.score.recommendation;
  const action = actionLabel(rec);
  return (
    <Card pad={16}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <ScoreRing score={scored.score.total} size={56} stroke={5} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
            <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: T.text1 }}>{scored.ticker}</span>
            <span className="mono" style={{ fontSize: 13, color: T.text3 }}>${scored.price.toFixed(2)}</span>
            <ActionBadge action={action} />
          </div>
          {rec && (
            <div className="mono" style={{ fontSize: 12.5, color: T.text2 }}>
              {rec.side === 'BUY' ? 'Buy' : 'Sell'} {rec.strategy.includes('call') ? 'Call' : 'Put'} ${rec.strike} · {rec.expiration} · {rec.contracts}× @ ${rec.limitPrice.toFixed(2)} · Δ{rec.delta.toFixed(3)} · {rec.dte}DTE
            </div>
          )}
          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
            {([
              ['WHALE', scored.score.components.whale],
              ['CONV', scored.score.components.conviction],
              ['IV', scored.score.components.ivEdge],
              ['REGIME', scored.score.components.regime],
              ['LIQ', scored.score.components.liquidity],
            ] as const).map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 9.5, color: T.text4, letterSpacing: '0.06em' }}>{k}</div>
                <div style={{ height: 3, background: T.void, marginTop: 3, borderRadius: 1.5, overflow: 'hidden' }}>
                  <div style={{ width: `${v}%`, height: '100%', background: T.buy }} />
                </div>
                <div className="mono" style={{ fontSize: 10, color: T.text2, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: T.text3 }}>
            {scored.score.reasoning.slice(0, 2).join(' · ')}
          </div>
        </div>
        <button onClick={() => onSelect(scored)} style={{ background: 'rgba(0,230,138,0.12)', color: T.buy, border: `1px solid rgba(0,230,138,0.35)`, padding: '8px 14px', borderRadius: 4, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', cursor: 'pointer' }}>
          EXECUTE →
        </button>
      </div>
    </Card>
  );
}

function TopTenRow({ scored, rank, onSelect }: { scored: ScoredTicker; rank: number; onSelect: (s: ScoredTicker) => void }) {
  const rec = scored.score.recommendation;
  return (
    <tr onClick={() => onSelect(scored)} style={{ borderBottom: `1px solid ${T.borderSubtle}`, cursor: 'pointer' }}>
      <td style={{ padding: '10px 12px', color: T.text4, fontSize: 11 }}>{String(rank).padStart(2, '0')}</td>
      <td style={{ padding: '10px 12px', color: T.text1, fontWeight: 600 }}>{scored.ticker}</td>
      <td style={{ padding: '10px 12px' }}>{rec ? <ActionBadge action={actionLabel(rec)} size="sm" /> : '—'}</td>
      <td style={{ padding: '10px 12px', color: T.text2 }}>{rec ? `$${rec.strike}` : '—'}</td>
      <td style={{ padding: '10px 12px', color: T.text3 }}>{rec?.expiration ?? '—'}</td>
      <td style={{ padding: '10px 12px', color: T.buy, textAlign: 'right' }}>{rec ? `$${rec.limitPrice.toFixed(2)}` : '—'}</td>
      <td style={{ padding: '10px 12px', color: T.text2, textAlign: 'right' }}>{scored.score.components.whale}</td>
      <td style={{ padding: '10px 12px', color: T.text2, textAlign: 'right' }}>{scored.medallion?.signals.ivRank.toFixed(0) ?? '—'}</td>
      <td style={{ padding: '10px 12px', color: T.text1, fontWeight: 600, textAlign: 'right' }}>{scored.score.total}</td>
    </tr>
  );
}

function ScannerRow({ scored, onSelect }: { scored: ScoredTicker; onSelect: (s: ScoredTicker) => void }) {
  const rec = scored.score.recommendation;
  return (
    <tr onClick={() => onSelect(scored)} style={{ borderBottom: `1px solid ${T.borderSubtle}`, cursor: 'pointer' }}>
      <td style={{ padding: '8px 12px', color: T.text1, fontWeight: 600 }}>{scored.ticker}</td>
      <td style={{ padding: '8px 12px', color: rec?.side === 'BUY' ? T.arb : rec?.side === 'SELL' ? T.buy : T.text4 }}>
        {rec?.side ?? '—'}
      </td>
      <td style={{ padding: '8px 12px', color: T.text3, fontSize: 11 }}>
        {rec ? `$${rec.strike}${rec.strategy.includes('call') ? 'C' : 'P'} ${rec.expiration} ${rec.contracts}× @ $${rec.limitPrice.toFixed(2)}` : '—'}
      </td>
      <td style={{ padding: '8px 12px', color: T.text2, textAlign: 'right' }}>{scored.score.components.whale}</td>
      <td style={{ padding: '8px 12px', color: T.text2, textAlign: 'right' }}>{scored.medallion?.signals.ivRank.toFixed(0) ?? '—'}</td>
      <td style={{ padding: '8px 12px', color: T.text2, textAlign: 'right' }}>{scored.medallion ? `${(scored.medallion.signals.vrp * 100).toFixed(1)}%` : '—'}</td>
      <td style={{ padding: '8px 12px', color: T.text2, textAlign: 'right' }}>{scored.whale ? `${scored.whale.volumeRatio.toFixed(1)}×` : '—'}</td>
      <td style={{ padding: '8px 12px', color: T.arb, fontWeight: 600, textAlign: 'right' }}>{scored.score.total}</td>
    </tr>
  );
}

function BlockedSection({ items }: { items: TodayResponse['blocked'] }) {
  const [open, setOpen] = useState(false);
  return (
    <section style={{ marginTop: 28 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '8px 0', borderBottom: `1px solid ${T.borderSubtle}`, background: 'transparent', border: 'none', color: T.text3, cursor: 'pointer', fontSize: 12 }}
      >
        <span>Blocked Signals · {items.length} filtered</span>
        <span>{open ? '▼' : '▶'}</span>
      </button>
      {open && (
        <div className="mono" style={{ marginTop: 10, fontSize: 11, color: T.text3 }}>
          {items.map((i, idx) => (
            <div key={idx} style={{ padding: '4px 0' }}>
              <span style={{ color: T.text1, fontWeight: 600, marginRight: 10 }}>{i.ticker}</span>
              {i.reason}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
