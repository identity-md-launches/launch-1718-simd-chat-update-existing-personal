import type { Candle } from '../types';

export type Workspace = 'intraday' | 'swing';
export type VwapPeriod = 'session' | 'week';
export const intervalLabel = (minutes: number) => minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${minutes / 60}h` : `${minutes / 1440}d`;
export const utcLabel = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ');
export function periodStart(time: number, period: VwapPeriod): number {
  const day = Math.floor(time / 86400) * 86400;
  return period === 'session' ? day : day - ((new Date(day * 1000).getUTCDay() + 6) % 7) * 86400;
}

/** Only fully covered buckets are eligible. Unknown intervals are never filled. */
export function aggregateComplete(candles: Candle[], sourceMinutes: number, minutes: number): Candle[] {
  if (minutes < sourceMinutes || minutes % sourceMinutes) return [];
  if (sourceMinutes === minutes) return candles;
  const buckets = new Map<number, Candle[]>();
  for (const bar of candles) {
    const key = Math.floor(bar.time / (minutes * 60)) * minutes * 60;
    buckets.set(key, [...(buckets.get(key) ?? []), bar]);
  }
  return [...buckets.entries()].flatMap(([time, group]) => {
    if (group.length !== minutes / sourceMinutes || group.some((bar, i) => bar.time !== time + i * sourceMinutes * 60)) return [];
    return [{ time, open: group[0].open, high: Math.max(...group.map(c => c.high)), low: Math.min(...group.map(c => c.low)), close: group.at(-1)!.close, volume: group.reduce((s, c) => s + c.volume, 0), sentiment: group.at(-1)!.sentiment }];
  });
}

export function researchIndicators(candles: Candle[], minutes: number, vwapPeriod: VwapPeriod = 'session', rsiPeriod = 14) {
  const out = { rsi: [] as (number | null)[], atr: [] as (number | null)[], rvol: [] as (number | null)[], vwap: [] as (number | null)[], ema20: [] as number[], ema50: [] as number[], ema200: [] as number[], macd: [] as (number | null)[], signal: [] as (number | null)[], histogram: [] as (number | null)[], coverage: [] as number[] };
  let count = 0, gain = 0, loss = 0, atr = 0, e12 = 0, e26 = 0, e20 = 0, e50 = 0, e200 = 0, sig = 0;
  let anchor = -1, pv = 0, volume = 0, covered = false;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i], prev = candles[i - 1], gap = !prev || c.time !== prev.time + minutes * 60;
    if (gap) { count = 0; gain = 0; loss = 0; atr = 0; e12 = e26 = e20 = e50 = e200 = c.close; sig = 0; }
    count++;
    if (count > 1) {
      const change = c.close - prev.close, up = Math.max(0, change), down = Math.max(0, -change);
      if (count <= rsiPeriod + 1) { gain += up / rsiPeriod; loss += down / rsiPeriod; }
      else { gain = (gain * (rsiPeriod - 1) + up) / rsiPeriod; loss = (loss * (rsiPeriod - 1) + down) / rsiPeriod; }
      const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
      atr = count <= 15 ? atr + tr / 14 : (atr * 13 + tr) / 14;
      const smooth = (old: number, n: number) => old + 2 / (n + 1) * (c.close - old);
      e12 = smooth(e12, 12); e26 = smooth(e26, 26); e20 = smooth(e20, 20); e50 = smooth(e50, 50); e200 = smooth(e200, 200);
      sig += 2 / 10 * (e12 - e26 - sig);
    }
    const nextAnchor = periodStart(c.time, vwapPeriod);
    if (nextAnchor !== anchor || gap) { anchor = nextAnchor; pv = 0; volume = 0; covered = c.time === anchor; }
    pv += (c.high + c.low + c.close) / 3 * c.volume; volume += c.volume;
    const precedingVolume = count > 20 ? candles.slice(i - 20, i).reduce((sum, bar) => sum + bar.volume, 0) / 20 : 0;
    out.coverage.push(count);
    out.rsi.push(count <= rsiPeriod ? null : !gain && !loss ? 50 : !loss ? 100 : 100 - 100 / (1 + gain / loss));
    out.atr.push(count < 15 ? null : atr);
    out.rvol.push(count > 20 && precedingVolume > 0 ? c.volume / precedingVolume : null);
    out.vwap.push(covered && volume > 0 ? pv / volume : null);
    out.ema20.push(e20); out.ema50.push(e50); out.ema200.push(e200);
    out.macd.push(count >= 130 ? e12 - e26 : null);
    out.signal.push(count >= 130 ? sig : null);
    out.histogram.push(count >= 130 ? e12 - e26 - sig : null);
  }
  return out;
}
export type ResearchSettings = { rsiPeriod: number; rvolThreshold: number; atrMultiplier: number; vwapPeriod: VwapPeriod };
export const DEFAULT_RESEARCH: ResearchSettings = { rsiPeriod: 14, rvolThreshold: 1.5, atrMultiplier: 2, vwapPeriod: 'session' };
export type Condition = { label: string; met: boolean | null; detail: string };
export function researchConditions(candles: Candle[], data: ReturnType<typeof researchIndicators>, i: number, workspace: Workspace, settings: ResearchSettings): Condition[] {
  const last = candles[i], prev = candles[i - 1], count = data.coverage[i] ?? 0;
  const strength = data.rsi[i], rvol = data.rvol[i], vwap = data.vwap[i];
  const conditions: Condition[] = workspace === 'intraday' ? [
    { label: `Price reclaims ${settings.vwapPeriod === 'session' ? 'session' : 'weekly'} VWAP`, met: vwap != null && data.vwap[i - 1] != null && !!prev ? prev.close <= data.vwap[i - 1]! && last.close > vwap : null, detail: vwap == null ? 'Complete anchor coverage required' : 'Previous close below; latest close above' },
    { label: `Relative volume ≥ ${settings.rvolThreshold.toFixed(1)}×`, met: rvol == null ? null : rvol >= settings.rvolThreshold, detail: rvol == null ? '21 contiguous bars with volume required' : `Latest closed bar: ${rvol.toFixed(2)}×` },
    { label: `RSI (${settings.rsiPeriod}) between 50 and 70`, met: strength == null ? null : strength >= 50 && strength <= 70, detail: strength == null ? 'Warming up' : `Momentum: ${strength.toFixed(1)}` },
  ] : [
    { label: 'EMA 20 above EMA 50', met: count < 250 ? null : data.ema20[i] > data.ema50[i], detail: count < 250 ? `${count} / 250 contiguous bars` : 'Trend confirmation on the selected interval' },
    { label: 'MACD crosses above signal', met: data.macd[i - 1] == null || data.macd[i] == null ? null : data.macd[i - 1]! <= data.signal[i - 1]! && data.macd[i]! > data.signal[i]!, detail: 'A new cross, not a persistent positive value' },
    { label: 'Closed price above EMA 20', met: count < 100 ? null : last.close > data.ema20[i], detail: count < 100 ? `${count} / 100 contiguous bars` : 'Price confirms the trend' },
  ];
  return conditions;
}
export function researchSignal(candles: Candle[], minutes: number, workspace: Workspace, settings: ResearchSettings, fresh = true) {
  const data = researchIndicators(candles, minutes, settings.vwapPeriod, settings.rsiPeriod), i = candles.length - 1;
  const last = candles[i], prev = candles[i - 1], count = data.coverage[i] ?? 0;
  const strength = data.rsi[i], rvol = data.rvol[i], atr = data.atr[i], vwap = data.vwap[i];
  const conditions = researchConditions(candles, data, i, workspace, settings);
  const ready = !!last && fresh && conditions.every(c => c.met !== null);
  const matched = conditions.filter(c => c.met).length, qualifies = ready && matched === conditions.length;
  const atrBaseline = data.atr.slice(-51, -1).filter((v): v is number => v !== null);
  const normalAtr = atrBaseline.length === 50 ? atrBaseline.reduce((a, b) => a + b, 0) / 50 : null;
  const regime = atr == null || normalAtr == null ? 'Warming up' : atr > normalAtr * 1.3 ? 'Elevated' : atr < normalAtr * .7 ? 'Quiet' : 'Normal';
  return { data, conditions, matched, qualifies, ready, label: !fresh ? 'Feed paused or stale' : !ready ? 'Needs more data' : qualifies ? 'Setup detected' : 'Waiting for confirmation', name: workspace === 'intraday' ? 'VWAP reclaim' : 'Trend continuation', rsi: strength ?? null, rvol: rvol ?? null, atr: atr ?? null, vwap: vwap ?? null, regime, count, stopDistance: atr == null ? null : atr * settings.atrMultiplier };
}

export function priorLevels(candles: Candle[], minutes: number, period: VwapPeriod) {
  if (!candles.length) return null;
  const end = periodStart(candles.at(-1)!.time, period), start = end - (period === 'week' ? 604800 : 86400);
  const bars = candles.filter(c => c.time >= start && c.time < end);
  if (bars.length !== (end - start) / (minutes * 60) || bars.some((b, i) => b.time !== start + i * minutes * 60)) return null;
  return { high: Math.max(...bars.map(c => c.high)), low: Math.min(...bars.map(c => c.low)), close: bars.at(-1)!.close };
}
