import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { AssetIcon, Badge, Modal } from './components';
import { money } from './lib/engine';
import { openPosition, portfolioMetrics, sizeWithCosts, type Portfolio, type SizingInput } from './lib/portfolio';
import { intervalLabel, researchSignal, type ResearchSettings, type Workspace } from './lib/research';
import type { Snapshot } from './types';

export default function PaperTicket({ snapshot, portfolio, settings, workspace, fresh, onSave, onClose }: { snapshot: Snapshot; portfolio: Portfolio; settings: ResearchSettings; workspace: Workspace; fresh: boolean; onSave: (p: Portfolio) => boolean; onClose: () => void }) {
  const metrics = portfolioMetrics(portfolio), technical = researchSignal(snapshot.candles, snapshot.interval ?? 5, workspace, settings, fresh);
  const distance = technical.stopDistance;
  const [stop, setStop] = useState(distance == null ? '' : Math.max(.01, snapshot.price - distance).toFixed(2)), [target, setTarget] = useState(distance == null ? '' : (snapshot.price + 2 * distance).toFixed(2)), [fee, setFee] = useState('0.26'), [slip, setSlip] = useState('5'), [checked, setChecked] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState('');
  const existing = portfolio.positions.filter(v => v.asset === snapshot.asset).reduce((s, v) => s + v.quantity * v.mark, 0);
  const input: SizingInput = { equity: metrics.equity, freeCash: portfolio.cash, riskPct: portfolio.limits.perTrade, entry: snapshot.price, stop: +stop, target: +target, entryFee: +fee, exitFee: +fee, slippageBps: +slip, lotSize: snapshot.lotSize ?? .000001, maxNotional: Math.max(0, metrics.equity * portfolio.limits.assetCap / 100 - existing), remainingRisk: metrics.remainingRisk, side: 'buy' };
  let estimate: ReturnType<typeof sizeWithCosts> | null = null;
  try { estimate = sizeWithCosts(input); } catch { /* Submission reports the actionable error. */ }
  const stalePositions = snapshot.mode === 'live' && portfolio.positions.some(p => p.asset !== snapshot.asset && snapshot.asOf - p.markedAt > 90);
  function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      if (!fresh || stalePositions) throw new Error('Refresh this market and every open position before opening a new paper trade.');
      if (!checked) throw new Error('Confirm that this is a local paper simulation.');
      if ([stop, target, fee, slip].some(v => !v.trim())) throw new Error('Enter the stop, target, fee and slippage assumptions.');
      if (snapshot.mode === 'live' && !snapshot.lotSize) throw new Error('Instrument limits are unavailable. Use the public Kraken feed before opening a paper position.');
      const next = openPosition(portfolio, snapshot.asset, input, snapshot.asOf, `Manual review · ${technical.name} v2 · ${intervalLabel(snapshot.interval ?? 5)}`, snapshot.interval ?? 5, snapshot.orderMin);
      const persisted = onSave(next);
      setSaved(persisted ? 'Paper position opened and saved in this browser.' : 'Paper position opened for this session. Browser storage is unavailable; export the ledger to keep it.');
    } catch (error) { setError((error as Error).message); document.getElementById('ticket-stop')?.focus(); }
  }
  return <Modal title="Review paper trade" onClose={onClose}>{saved ? <div className="empty-state order-success"><span className="success-icon"><Check size={28} /></span><h3>Position opened</h3><p role="status">{saved}</p><button className="button primary" onClick={() => { onClose(); location.hash = 'portfolio'; }}>View paper portfolio<ArrowRight size={16} /></button></div> : <form className="form-stack" onSubmit={submit}>
    <div className="paper-market"><AssetIcon asset={snapshot.asset} /><div><strong>{snapshot.asset} / USD · Long</strong><span>{money(snapshot.price)} quoted entry</span></div><Badge tone="warning">{snapshot.mode === 'demo' ? 'Demo paper' : 'Live-data paper'}</Badge></div>
    <p className="muted small-text">{technical.name}: {technical.matched} of {technical.conditions.length} conditions met. This is a manual decision, not an automatic signal entry.</p>
    <div className="field-grid"><label>Stop loss (USD)<input id="ticket-stop" type="number" inputMode="decimal" min=".000001" step="any" value={stop} onChange={e => setStop(e.target.value)} required aria-invalid={!!error} aria-describedby={error ? 'ticket-error' : undefined} /></label><label>Take profit (USD)<input type="number" inputMode="decimal" min=".000001" step="any" value={target} onChange={e => setTarget(e.target.value)} required /></label><label>Fee per side (%)<input type="number" min="0" max="5" step=".01" value={fee} onChange={e => setFee(e.target.value)} required /></label><label>Slippage per side (bps)<input type="number" min="0" max="500" step="1" value={slip} onChange={e => setSlip(e.target.value)} required /></label></div>
    <dl className="detail-list ticket-estimate"><div><dt>Position size</dt><dd>{estimate ? `${estimate.quantity.toFixed(6)} ${snapshot.asset}` : 'Check prices'}</dd></div><div><dt>Cash reserved incl. entry fee</dt><dd>{estimate ? money(estimate.cashRequired) : 'Unavailable'}</dd></div><div><dt>Planned loss incl. costs</dt><dd>{estimate ? money(estimate.plannedLoss) : 'Unavailable'}</dd></div><div><dt>Net reward / risk</dt><dd>{estimate ? `${estimate.ratio.toFixed(2)}R` : 'Unavailable'}</dd></div><div><dt>Per-trade / asset limits</dt><dd>{portfolio.limits.perTrade}% / {portfolio.limits.assetCap}%</dd></div></dl>
    <p className="field-hint"><ShieldCheck size={14} /> {distance == null ? 'ATR is unavailable. Set your stop and target manually.' : `Stop defaults to ${settings.atrMultiplier} × Wilder ATR on ${intervalLabel(snapshot.interval ?? 5)} bars.`} Stops can lose more during gaps. Fees are assumptions. Selected-market exits are simulated on fully closed bars after entry while this app is open.</p>
    {metrics.locked && <p className="form-error">Daily loss limit reached. Existing positions can still be closed.</p>}
    <label className="checkbox-label"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} required />I understand this uses simulated funds stored in this browser.</label>
    {error && <p id="ticket-error" role="alert" className="form-error">{error}</p>}
    <button className="button primary full-width" type="submit">Open paper position<ArrowRight size={16} /></button>
  </form>}</Modal>;
}
