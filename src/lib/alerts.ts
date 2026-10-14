import type { Asset } from '../types';
import type { Condition, Workspace } from './research';
export type ResearchAlert = { id: string; time: number; asset: Asset; interval: number; workspace: Workspace; mode: 'demo' | 'live'; rule: string; conditions: Condition[] };
export function appendAlert(alerts: ResearchAlert[], next: ResearchAlert): ResearchAlert[] {
  if (alerts.some(a => a.id === next.id)) return alerts;
  // One event per rule, market, interval and closed candle, across refresh/reconnect.
  return [next, ...alerts].slice(0, 200);
}
export function validAlerts(value: unknown): value is ResearchAlert[] {
  return Array.isArray(value) && value.length <= 200 && value.every(a => a && typeof a.id === 'string' && typeof a.rule === 'string' && ['BTC', 'ETH', 'SOL', 'BNB'].includes(a.asset) && ['intraday', 'swing'].includes(a.workspace) && ['demo', 'live'].includes(a.mode) && Number.isFinite(a.time) && Number.isFinite(a.interval) && Array.isArray(a.conditions) && a.conditions.every((c: Condition) => typeof c.label === 'string' && typeof c.detail === 'string' && (typeof c.met === 'boolean' || c.met === null)));
}
