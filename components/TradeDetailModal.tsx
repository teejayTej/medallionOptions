'use client';

import { useEffect, useState } from 'react';
import type { ScoredTicker } from '@/lib/engine/scoring';
import { addPosition } from '@/lib/store/positions';
import { Sparkline, SignalPill, fmtExp } from '@/components/obsidian/TradesView';

export function TradeDetailModal({
  scored,
  onClose,
}: {
  scored: ScoredTicker;
  onClose: () => void;
}) {
  const { score, ticker, price, whale, medallion, reference, earnings } = scored;
  const rec = score.recommendation;
  const [tracked, setTracked] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function copySteps() {
    if (!rec) return;
    navigator.clipboard.writeText(rec.robinhoodSteps.join(' → ')).catch(() => {});
  }

  function trackPosition() {
    if (!rec) return;
    addPosition({
      ticker,
      contract: rec.contract,
      side: rec.side,
      strategy: rec.strategy,
      strike: rec.strike,
      expiration: rec.expiration,
      entryPrice: rec.limitPrice,
      contracts: rec.contracts,
      exitRules: {
        profitTargetPrice: rec.exitRules.profitTargetPrice,
        stopLossPrice: rec.exitRules.stopLossPrice,
        dteCutoffDate: rec.exitRules.dteCutoffDate,
      },
    });
    setTracked(true);
    setTimeout(onClose, 800);
  }

  const sparkData = (medallion as unknown as { prices?: number[] })?.prices?.slice(-90) ?? [];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(5,5,8,0.7)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        overflowY: 'auto',
        padding: '60px 24px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="anim-modal-in"
        style={{
          width: 'min(1100px, 100%)',
          background: 'var(--obsidian-900)',
          border: '1px solid var(--border-strong)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        {/* Modal head */}
        <div
          className="flex items-center"
          style={{
            gap: 14,
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <span className="mono" style={{ fontSize: 24, fontWeight: 600 }}>{ticker}</span>
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--text-500)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {reference.tier.toUpperCase()} · ${price.toFixed(2)} · TIER {score.tier.replace('_', ' ').toUpperCase()}
          </span>
          {rec && <SignalPill rec={rec} />}
          <button
            onClick={onClose}
            className="mono"
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              color: 'var(--text-500)',
              letterSpacing: '0.1em',
              padding: '6px 10px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 4,
            }}
          >
            ESC
          </button>
        </div>

        {/* Body — two columns */}
        <div className="grid" style={{ gridTemplateColumns: '1.2fr 1fr', gap: 0 }}>
          {/* LEFT: chart + metrics */}
          <div style={{ padding: 20, borderRight: '1px solid var(--border-subtle)' }}>
            {/* Chart placeholder with real sparkline */}
            <div
              style={{
                height: 200,
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                background: 'var(--obsidian-900)',
                position: 'relative',
                overflow: 'hidden',
                padding: 10,
              }}
            >
              <span
                className="mono"
                style={{
                  position: 'absolute',
                  top: 10,
                  left: 14,
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  color: 'var(--text-500)',
                  textTransform: 'uppercase',
                }}
              >
                90-DAY DAILY CLOSES
              </span>
              <span
                className="mono"
                style={{
                  position: 'absolute',
                  top: 10,
                  right: 14,
                  fontSize: 10,
                  color: 'var(--text-500)',
                }}
              >
                {sparkData.length > 0 ? `n=${sparkData.length}` : 'no history'}
              </span>
              <div style={{ paddingTop: 30 }}>
                {sparkData.length > 1 ? (
                  <Sparkline data={sparkData} width={620} height={150} />
                ) : (
                  <div className="mono" style={{ textAlign: 'center', paddingTop: 60, color: 'var(--text-500)', fontSize: 11 }}>
                    historical bars not available
                  </div>
                )}
              </div>
            </div>

            {/* Component scores grid */}
            <div className="grid mt-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 16 }}>
              {([
                ['whale', 'WHALE', score.components.whale],
                ['conviction', 'CONVICTION', score.components.conviction],
                ['ivEdge', 'IV EDGE', score.components.ivEdge],
                ['regime', 'REGIME', score.components.regime],
                ['liquidity', 'LIQUIDITY', score.components.liquidity],
                ['total', 'TOTAL', score.total],
              ] as const).map(([k, label, v]) => (
                <Metric key={k} k={label} v={String(v)} tone={v >= 70 ? 'pos' : v >= 50 ? 'warn' : v >= 30 ? 'neutral' : 'neg'} />
              ))}
            </div>

            {/* Gates */}
            <div style={{ marginTop: 18 }}>
              <h4
                className="mono"
                style={{
                  margin: '0 0 8px',
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--text-500)',
                  fontWeight: 500,
                }}
              >
                Gates
              </h4>
              <div className="flex flex-col" style={{ gap: 4 }}>
                {score.gates.map((g) => (
                  <div key={g.name} className="flex items-center mono" style={{ gap: 8, fontSize: 11 }}>
                    <span style={{ color: g.passed ? 'var(--sage-400)' : 'var(--terra-400)' }}>
                      {g.passed ? '✓' : '✗'}
                    </span>
                    <span
                      style={{
                        color: 'var(--text-500)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        fontSize: 10,
                        width: 88,
                      }}
                    >
                      {g.name}
                    </span>
                    <span style={{ color: 'var(--text-300)', fontSize: 11 }}>{g.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT: execution card + reasoning + steps */}
          <div style={{ padding: 20, background: 'var(--obsidian-800)' }}>
            {rec ? (
              <>
                <ExecutionCard rec={rec} />

                {rec.reasoning.length > 0 && (
                  <div style={{ marginTop: 18 }}>
                    <h4
                      className="mono"
                      style={{
                        margin: '0 0 8px',
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: 'var(--text-500)',
                        fontWeight: 500,
                      }}
                    >
                      REASONING
                    </h4>
                    {rec.reasoning.map((r, i) => (
                      <div
                        key={i}
                        className="grid"
                        style={{
                          gridTemplateColumns: '24px 1fr',
                          gap: 10,
                          padding: '8px 0',
                          borderBottom: i === rec.reasoning.length - 1 ? '0' : '1px dashed var(--border-subtle)',
                          fontSize: 13,
                          color: 'var(--text-300)',
                          lineHeight: 1.5,
                        }}
                      >
                        <span className="mono" style={{ fontSize: 10, color: 'var(--text-500)', letterSpacing: '0.1em' }}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span>{r}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Robinhood steps */}
                <div style={{ marginTop: 18 }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
                    <h4
                      className="mono"
                      style={{
                        margin: 0,
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: 'var(--text-500)',
                        fontWeight: 500,
                      }}
                    >
                      ROBINHOOD EXECUTION
                    </h4>
                    <button
                      onClick={copySteps}
                      className="mono"
                      style={{
                        fontSize: 10,
                        color: 'var(--sage-400)',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                      }}
                    >
                      COPY STEPS
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center" style={{ gap: 6 }}>
                    {rec.robinhoodSteps.map((step, i) => (
                      <span key={i} className="flex items-center" style={{ gap: 6 }}>
                        <span
                          className="mono"
                          style={{
                            padding: '5px 9px',
                            background: 'var(--obsidian-900)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 4,
                            color: 'var(--text-300)',
                            fontSize: 11.5,
                          }}
                        >
                          {step}
                        </span>
                        {i < rec.robinhoodSteps.length - 1 && (
                          <span className="mono" style={{ color: 'var(--sage-500)' }}>→</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Track button */}
                <div style={{ marginTop: 22, display: 'flex', gap: 8 }}>
                  <button
                    onClick={onClose}
                    className="mono"
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      background: 'transparent',
                      color: 'var(--text-300)',
                      fontSize: 11,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 4,
                    }}
                  >
                    CANCEL
                  </button>
                  <button
                    onClick={trackPosition}
                    className="mono"
                    style={{
                      flex: 2,
                      padding: '10px 16px',
                      background: tracked ? 'var(--sage-500)' : 'var(--sage-400)',
                      color: 'var(--obsidian-950)',
                      fontWeight: 600,
                      fontSize: 11,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      borderRadius: 4,
                    }}
                  >
                    {tracked ? '✓ TRACKED' : 'TRACK AS OPEN POSITION'}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-500)' }}>
                <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em' }}>NO RECOMMENDATION</div>
                <div className="mono" style={{ fontSize: 10, marginTop: 6, opacity: 0.6 }}>
                  Gates blocked entry — see left panel
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer micro-strip */}
        {whale && medallion && (
          <div
            className="mono"
            style={{
              padding: '12px 20px',
              borderTop: '1px solid var(--border-subtle)',
              fontSize: 10.5,
              color: 'var(--text-500)',
              letterSpacing: '0.04em',
              display: 'flex',
              gap: 18,
              flexWrap: 'wrap',
            }}
          >
            <span>VOL {whale.volumeRatio.toFixed(1)}×</span>
            <span>C/P {whale.callPutRatio.toFixed(2)}</span>
            <span>NETΔ {whale.netDelta.toFixed(0)}</span>
            <span>FLOW {whale.flowSignal.replace(/_/g, ' ')}</span>
            <span>IVR {medallion.signals.ivRank.toFixed(0)}</span>
            <span>VRP {(medallion.signals.vrp * 100).toFixed(1)}%</span>
            <span>REGIME {medallion.regime.label}</span>
            {earnings.earningsDate && <span>EARN {earnings.earningsDate} ({earnings.daysToEarnings}d)</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function ExecutionCard({ rec }: { rec: NonNullable<ScoredTicker['score']['recommendation']> }) {
  const total = Math.abs(rec.limitPrice * 100 * rec.contracts);
  const sideLabel = rec.side === 'BUY' ? 'BUY' : 'SELL';
  const cpLabel = rec.strategy.includes('call') ? 'CALL' : 'PUT';

  return (
    <div
      style={{
        background: 'var(--obsidian-900)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--text-500)',
        }}
      >
        EXECUTE
      </span>
      <div className="mono" style={{ fontSize: 18, color: 'var(--text-100)', lineHeight: 1.4 }}>
        {sideLabel} {cpLabel} ${rec.strike}{' '}
        <span style={{ color: 'var(--text-500)' }}>·</span> {fmtExp(rec.expiration)}
        <br />
        <span style={{ fontSize: 14, color: 'var(--text-300)' }}>
          {rec.contracts}× @ <span style={{ color: 'var(--sage-400)' }}>${rec.limitPrice.toFixed(2)}</span>
          {' · '}
          Δ{rec.delta.toFixed(2)}
          {' · '}
          {rec.dte}D
        </span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Cell k={rec.side === 'BUY' ? 'TOTAL DEBIT' : 'TOTAL CREDIT'} v={`$${total.toFixed(0)}`} tone={rec.side === 'BUY' ? 'neg' : 'pos'} />
        <Cell k="MAX RISK" v={`$${rec.maxLoss.toFixed(0)}`} tone="neg" />
        <Cell k="PROFIT TARGET" v={`$${rec.exitRules.profitTargetPrice.toFixed(2)}`} tone="pos" />
        <Cell k="STOP LOSS" v={`$${rec.exitRules.stopLossPrice.toFixed(2)}`} tone="neg" />
      </div>

      <div className="mono" style={{ fontSize: 10, color: 'var(--text-500)', letterSpacing: '0.04em' }}>
        TIME STOP {rec.exitRules.dteCutoffDate} · OCC {rec.contract}
      </div>
    </div>
  );
}

function Metric({ k, v, tone }: { k: string; v: string; tone: 'pos' | 'neg' | 'warn' | 'neutral' }) {
  const color =
    tone === 'pos' ? 'var(--sage-400)' :
    tone === 'neg' ? 'var(--terra-400)' :
    tone === 'warn' ? 'var(--amber-400)' :
    'var(--text-100)';
  return (
    <div
      style={{
        padding: '10px 12px',
        background: 'var(--obsidian-900)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 6,
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 9,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--text-500)',
          marginBottom: 4,
        }}
      >
        {k}
      </div>
      <div className="mono" style={{ fontSize: 14, color }}>{v}</div>
    </div>
  );
}

function Cell({ k, v, tone }: { k: string; v: string; tone: 'pos' | 'neg' }) {
  const color = tone === 'pos' ? 'var(--sage-400)' : 'var(--terra-400)';
  return (
    <div
      style={{
        padding: '10px 12px',
        background: 'var(--obsidian-800)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 6,
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 9,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--text-500)',
          marginBottom: 4,
        }}
      >
        {k}
      </div>
      <div className="mono" style={{ fontSize: 18, color }}>{v}</div>
    </div>
  );
}
