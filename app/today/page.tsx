'use client';

import { useEffect, useState } from 'react';
import type { ScoredTicker } from '@/lib/engine/scoring';
import { TradeDetailModal } from '@/components/TradeDetailModal';
import { logScanEvents } from '@/lib/store/telemetry';
import {
  BlockedAccordion,
  MustTryCard,
  MustTryGrid,
  ScannerTable,
  SectionLabel,
  TopTenCard,
  TopTenGrid,
} from '@/components/obsidian/TradesView';

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

export default function TodayPage() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [universe, setUniverse] = useState('');
  const [portfolio, setPortfolio] = useState(100000);
  const [selected, setSelected] = useState<ScoredTicker | null>(null);
  const [sparks, setSparks] = useState<Map<string, number[]>>(new Map());

  // Auto-fetch on mount
  useEffect(() => {
    fetchToday(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // Fetch sparkline data for each shown ticker (last 30 daily closes)
      const shown = [...json.mustTry, ...json.topTen.slice(0, 10)];
      shown.forEach((s) => {
        const m = s.medallion;
        if (m && Array.isArray((m as unknown as { prices?: number[] }).prices)) {
          const prices = (m as unknown as { prices?: number[] }).prices ?? [];
          if (prices.length > 1) setSparks((prev) => new Map(prev).set(s.ticker, prices.slice(-30)));
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 1440, margin: '0 auto', width: '100%', padding: '28px 24px 80px' }}>
      {/* Toolbar — universe + scan */}
      <div
        className="flex items-end gap-3 flex-wrap"
        style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border-subtle)' }}
      >
        <label className="flex flex-col gap-1.5" style={{ flex: 1, minWidth: 280 }}>
          <span
            className="mono"
            style={{ fontSize: 10, color: 'var(--text-500)', letterSpacing: '0.1em', textTransform: 'uppercase' }}
          >
            UNIVERSE OVERRIDE — empty uses curated 26
          </span>
          <input
            type="text"
            value={universe}
            onChange={(e) => setUniverse(e.target.value)}
            placeholder="AAPL, NVDA, TSLA..."
            className="mono"
            style={{
              background: 'var(--obsidian-900)',
              border: '1px solid var(--border-strong)',
              borderRadius: 4,
              padding: '8px 12px',
              fontSize: 12.5,
              color: 'var(--text-100)',
              outline: 'none',
            }}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span
            className="mono"
            style={{ fontSize: 10, color: 'var(--text-500)', letterSpacing: '0.1em', textTransform: 'uppercase' }}
          >
            PORTFOLIO $
          </span>
          <input
            type="number"
            value={portfolio}
            onChange={(e) => setPortfolio(parseFloat(e.target.value) || 0)}
            className="mono"
            style={{
              background: 'var(--obsidian-900)',
              border: '1px solid var(--border-strong)',
              borderRadius: 4,
              padding: '8px 12px',
              fontSize: 12.5,
              color: 'var(--text-100)',
              outline: 'none',
              width: 120,
            }}
          />
        </label>
        <button
          onClick={() => fetchToday(false)}
          disabled={loading}
          className="mono"
          style={{
            background: loading ? 'var(--obsidian-800)' : 'var(--sage-400)',
            color: loading ? 'var(--text-500)' : 'var(--obsidian-950)',
            fontWeight: 600,
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            padding: '9px 18px',
            border: 'none',
            borderRadius: 4,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'SCANNING…' : 'RUN SCAN'}
        </button>
        {data && !loading && (
          <button
            onClick={() => fetchToday(true)}
            className="mono"
            style={{
              background: 'var(--obsidian-800)',
              color: 'var(--text-300)',
              fontSize: 11,
              padding: '9px 14px',
              border: '1px solid var(--border-strong)',
              borderRadius: 4,
              cursor: 'pointer',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            ↻ REFRESH
          </button>
        )}
        {error && (
          <div className="mono" style={{ marginLeft: 'auto', color: 'var(--terra-400)', fontSize: 11 }}>
            ERROR: {error}
          </div>
        )}
      </div>

      {!data && !loading && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-500)', fontSize: 13 }}>
          Hit <span style={{ color: 'var(--sage-400)', fontWeight: 600 }}>RUN SCAN</span> to pull live data.
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-500)', fontSize: 13 }}>
          <div className="mono" style={{ letterSpacing: '0.1em' }}>SCANNING UNIVERSE…</div>
          <div className="mono" style={{ fontSize: 10, marginTop: 6, opacity: 0.6 }}>
            POLYGON RATE LIMIT GATES TIMING — TYPICALLY 90–180s
          </div>
        </div>
      )}

      {data && (
        <>
          <SectionLabel
            name="MUST TRY"
            meta="SCORE ≥85 · WHALE ≥80"
            count={data.mustTry.length}
            first
          />
          {data.mustTry.length === 0 ? (
            <EmptyBox msg="No Must-Try picks today. Market doesn't meet conviction bar." />
          ) : (
            <MustTryGrid>
              {data.mustTry.map((s, i) => (
                <MustTryCard key={s.ticker} scored={s} rank={i + 1} spark={sparks.get(s.ticker)} onClick={() => setSelected(s)} />
              ))}
            </MustTryGrid>
          )}

          <SectionLabel name="TOP 10" meta="SCORE ≥70" count={data.topTen.length} />
          {data.topTen.length === 0 ? (
            <EmptyBox msg="Nothing qualified for Top 10." />
          ) : (
            <TopTenGrid>
              {data.topTen.map((s, i) => (
                <TopTenCard key={s.ticker} scored={s} rank={i + 1} spark={sparks.get(s.ticker)} onClick={() => setSelected(s)} />
              ))}
            </TopTenGrid>
          )}

          <SectionLabel name="SCANNER" meta="SCORE ≥50" count={data.scanner.length} />
          {data.scanner.length === 0 ? (
            <EmptyBox msg="No scanner-tier signals." />
          ) : (
            <ScannerTable rows={data.scanner} onRowClick={setSelected} />
          )}

          {data.blocked.length > 0 && <BlockedAccordion items={data.blocked} />}

          {data.notes.length > 0 && (
            <div className="mono" style={{ marginTop: 24, fontSize: 10, color: 'var(--text-500)', letterSpacing: '0.04em' }}>
              {data.notes.map((n, i) => (
                <div key={i} style={{ padding: '2px 0' }}>· {n}</div>
              ))}
            </div>
          )}
        </>
      )}

      {selected && <TradeDetailModal scored={selected} onClose={() => setSelected(null)} />}
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
