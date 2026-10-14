import type { Asset, Candle } from '../types';

export type SizingInput = { equity: number; freeCash: number; riskPct: number; entry: number; stop: number; target: number; entryFee: number; exitFee: number; slippageBps: number; lotSize: number; maxNotional: number; remainingRisk: number; side: 'buy' | 'sell' };
export function sizeWithCosts(input: SizingInput) {
  const { equity, freeCash, riskPct, entry, stop, target, entryFee, exitFee, slippageBps, lotSize, maxNotional, remainingRisk, side } = input;
  if (!Object.values(input).filter(v => typeof v === 'number').every(Number.isFinite) || Math.min(equity, entry, stop, target, lotSize) <= 0 || Math.min(freeCash, entryFee, exitFee, slippageBps, maxNotional, remainingRisk) < 0 || riskPct <= 0 || riskPct > 10 || entryFee > 5 || exitFee > 5 || slippageBps > 500) throw new Error('Use positive prices and equity, risk up to 10%, fees up to 5%, and slippage up to 500 bps.');
  if (side === 'buy' ? stop >= entry || target <= entry : stop <= entry || target >= entry) throw new Error(side === 'buy' ? 'Place the stop below entry and the target above entry.' : 'Place the stop above entry and the target below entry.');
  const direction = side === 'buy' ? 1 : -1, slip = slippageBps / 10000;
  const entryFill = entry * (1 + direction * slip), stopFill = stop * (1 - direction * slip), targetFill = target * (1 - direction * slip);
  const lossPerUnit = direction * (entryFill - stopFill) + entryFill * entryFee / 100 + stopFill * exitFee / 100;
  const rewardPerUnit = direction * (targetFill - entryFill) - entryFill * entryFee / 100 - targetFill * exitFee / 100;
  const riskBudget = equity * riskPct / 100;
  const raw = Math.min(riskBudget / lossPerUnit, remainingRisk / lossPerUnit, freeCash / (entryFill * (1 + entryFee / 100)), maxNotional / entryFill);
  const quantity = Number((Math.floor((raw + Number.EPSILON) / lotSize) * lotSize).toPrecision(12));
  return { quantity, entryFill, lossPerUnit, rewardPerUnit, notional: quantity * entryFill, cashRequired: quantity * entryFill * (1 + entryFee / 100), plannedLoss: quantity * lossPerUnit, potentialProfit: quantity * rewardPerUnit, riskBudget, ratio: rewardPerUnit / lossPerUnit, capped: raw < riskBudget / lossPerUnit, estimatedCosts: quantity * (entryFill * entryFee / 100 + stopFill * exitFee / 100 + Math.abs(entryFill - entry) + Math.abs(stop - stopFill)) };
}
export type Position = { id: string; asset: Asset; quantity: number; initialQuantity: number; entry: number; entryFee: number; stop: number; target: number; exitFee: number; slippageBps: number; openedAt: number; markedAt: number; checkedThrough: number; mark: number; plannedRisk: number; rule: string; interval: number };
export type Fill = { id: string; positionId: string; asset: Asset; time: number; quantity: number; price: number; fee: number; pnl: number; reason: string; side: 'buy' | 'sell' };
export type Limits = { perTrade: number; openRisk: number; dailyLoss: number; assetCap: number };
export type Portfolio = { version: 2; initialEquity: number; cash: number; positions: Position[]; fills: Fill[]; limits: Limits; day: number; dayStartEquity: number; changes: { time: number; limits: Limits }[] };
export const INITIAL_PORTFOLIO: Portfolio = { version: 2, initialEquity: 10000, cash: 10000, positions: [], fills: [], limits: { perTrade: .5, openRisk: 2, dailyLoss: 2, assetCap: 25 }, day: 0, dayStartEquity: 10000, changes: [] };
export function portfolioMetrics(p: Portfolio) {
  const markedValue = p.positions.reduce((s, v) => s + v.quantity * v.mark * (1 - v.exitFee / 100), 0);
  const equity = p.cash + markedValue;
  const openRisk = p.positions.reduce((s, v) => s + v.plannedRisk, 0);
  const dayLoss = Math.max(0, p.dayStartEquity - equity);
  const realized = p.fills.filter(f => f.side === 'sell').reduce((s, f) => s + f.pnl, 0);
  return { equity, openRisk, dayLoss, realized, dayLossPct: p.dayStartEquity ? dayLoss / p.dayStartEquity * 100 : 0, exposure: p.positions.reduce((s, v) => s + v.mark * v.quantity, 0), locked: equity <= 0 || dayLoss >= p.dayStartEquity * p.limits.dailyLoss / 100, remainingRisk: Math.max(0, equity * p.limits.openRisk / 100 - openRisk) };
}
export function exitPosition(p: Portfolio, id: string, fraction: number, quotedPrice: number, time: number, reason: string): Portfolio {
  const pos = p.positions.find(v => v.id === id);
  if (!pos || !Number.isFinite(fraction) || fraction <= 0 || fraction > 1 || !Number.isFinite(quotedPrice) || quotedPrice <= 0 || !Number.isFinite(time) || time < pos.openedAt) throw new Error('Use an open position, a current positive price and an exit fraction up to 100%.');
  const quantity = pos.quantity * fraction, price = quotedPrice * (1 - pos.slippageBps / 10000), fee = quantity * price * pos.exitFee / 100;
  const allocatedFee = pos.entryFee * fraction, pnl = quantity * (price - pos.entry) - allocatedFee - fee;
  return { ...p, cash: p.cash + quantity * price - fee, positions: fraction === 1 ? p.positions.filter(v => v.id !== id) : p.positions.map(v => v.id === id ? { ...v, quantity: v.quantity - quantity, entryFee: v.entryFee - allocatedFee, plannedRisk: v.plannedRisk * (1 - fraction) } : v), fills: [...p.fills, { id: `${id}-${p.fills.length}`, positionId: id, asset: pos.asset, time, quantity, price, fee, pnl, reason, side: 'sell' }] };
}
export function openPosition(p: Portfolio, asset: Asset, input: SizingInput, time: number, rule: string, interval: number, minimum = 0): Portfolio {
  const metrics = portfolioMetrics(p);
  if (metrics.locked) throw new Error('Daily loss limit reached. New paper positions are paused; exits remain available.');
  if (p.fills.length >= 2000) throw new Error('Export the full ledger before starting a new paper account. This account has reached its 2,000-fill limit.');
  if (input.side !== 'buy') throw new Error('The unlevered paper portfolio supports spot longs only. Short sizing is a separate scenario.');
  const existing = p.positions.filter(v => v.asset === asset).reduce((s, v) => s + v.quantity * v.mark, 0);
  const result = sizeWithCosts({ ...input, equity: metrics.equity, freeCash: p.cash, riskPct: Math.min(input.riskPct, p.limits.perTrade), maxNotional: Math.max(0, metrics.equity * p.limits.assetCap / 100 - existing), remainingRisk: metrics.remainingRisk });
  if (result.quantity <= 0 || result.quantity < minimum) throw new Error('The available risk, cash or asset limit is below the minimum order size. Reduce existing exposure.');
  if (result.ratio <= 0) throw new Error('Estimated trading costs exceed the target reward. Increase the target distance.');
  const id = crypto.randomUUID(), fee = result.notional * input.entryFee / 100;
  return { ...p, cash: p.cash - result.cashRequired, positions: [...p.positions, { id, asset, quantity: result.quantity, initialQuantity: result.quantity, entry: result.entryFill, entryFee: fee, stop: input.stop, target: input.target, exitFee: input.exitFee, slippageBps: input.slippageBps, openedAt: time, markedAt: time, checkedThrough: time, mark: input.entry, plannedRisk: result.plannedLoss, rule, interval }], fills: [...p.fills, { id, positionId: id, asset, time, quantity: result.quantity, price: result.entryFill, fee, pnl: 0, reason: rule, side: 'buy' }] };
}
/** Stops use only fully closed bars beginning after entry; stop wins if both levels touch. */
export function markPortfolio(p: Portfolio, asset: Asset, candles: Candle[], price: number, asOf: number, minutes: number): Portfolio {
  let next = p;
  const day = Math.floor(asOf / 86400);
  if (next.day !== day) next = { ...next, day, dayStartEquity: portfolioMetrics(next).equity };
  for (const position of [...next.positions].filter(v => v.asset === asset)) {
    for (const c of candles.filter(b => b.time >= position.openedAt && b.time + minutes * 60 > position.checkedThrough && b.time + minutes * 60 <= asOf)) {
      if (c.low <= position.stop) { next = exitPosition(next, position.id, 1, Math.min(c.open, position.stop), c.time + minutes * 60, 'Stop loss · closed-bar model'); break; }
      if (c.high >= position.target) { next = exitPosition(next, position.id, 1, Math.max(c.open, position.target), c.time + minutes * 60, 'Take profit · closed-bar model'); break; }
    }
  }
  return { ...next, positions: next.positions.map(v => v.asset === asset ? { ...v, mark: price, markedAt: asOf, checkedThrough: Math.max(v.checkedThrough, candles.at(-1) ? candles.at(-1)!.time + minutes * 60 : v.checkedThrough) } : v) };
}
export function validLimits(value: unknown): value is Limits {
  if (!value || typeof value !== 'object') return false;
  const l = value as Limits;
  return [l.perTrade, l.openRisk, l.dailyLoss, l.assetCap].every(Number.isFinite) && l.perTrade > 0 && l.perTrade <= 10 && l.openRisk >= l.perTrade && l.openRisk <= 20 && l.dailyLoss > 0 && l.dailyLoss <= 20 && l.assetCap > 0 && l.assetCap <= 100;
}
export function validPortfolio(value: unknown): value is Portfolio {
  if (!value || typeof value !== 'object') return false;
  const p = value as Portfolio, assets = ['BTC', 'ETH', 'SOL', 'BNB'];
  if (p.version !== 2 || ![p.initialEquity, p.cash, p.day, p.dayStartEquity].every(Number.isFinite) || p.initialEquity <= 0 || p.cash < -1e-6 || p.dayStartEquity <= 0 || !validLimits(p.limits) || !Array.isArray(p.positions) || p.positions.length > 100 || !Array.isArray(p.fills) || p.fills.length > 10000 || !Array.isArray(p.changes) || !p.changes.every(c => c && Number.isFinite(c.time) && validLimits(c.limits))) return false;
  if (!p.positions.every(v => v && typeof v.id === 'string' && assets.includes(v.asset) && typeof v.rule === 'string' && v.rule.length < 300 && [v.quantity, v.initialQuantity, v.entry, v.entryFee, v.stop, v.target, v.exitFee, v.slippageBps, v.openedAt, v.markedAt, v.checkedThrough, v.mark, v.plannedRisk, v.interval].every(Number.isFinite) && Math.min(v.quantity, v.entry, v.mark, v.stop, v.target, v.interval) > 0 && v.stop < v.entry && v.target > v.entry && v.quantity <= v.initialQuantity && v.exitFee >= 0 && v.exitFee <= 5 && v.slippageBps >= 0 && v.slippageBps <= 500 && v.plannedRisk >= 0 && v.entryFee >= 0 && v.markedAt >= v.openedAt)) return false;
  if (new Set(p.positions.map(v => v.id)).size !== p.positions.length) return false;
  if (!p.fills.every(f => f && typeof f.id === 'string' && typeof f.positionId === 'string' && assets.includes(f.asset) && ['buy', 'sell'].includes(f.side) && typeof f.reason === 'string' && f.reason.length < 300 && [f.time, f.quantity, f.price, f.fee, f.pnl].every(Number.isFinite) && Math.min(f.quantity, f.price, f.time) > 0 && f.fee >= 0)) return false;
  const expectedCash = p.fills.reduce((cash, f) => cash + (f.side === 'sell' ? 1 : -1) * f.quantity * f.price - f.fee, p.initialEquity);
  if (Math.abs(expectedCash - p.cash) > .01) return false;
  return p.positions.every(v => {
    const fills = p.fills.filter(f => f.positionId === v.id);
    return fills.length > 0 && fills[0].side === 'buy' && Math.abs(fills.reduce((q, f) => q + (f.side === 'buy' ? 1 : -1) * f.quantity, 0) - v.quantity) < 1e-8;
  });
}
