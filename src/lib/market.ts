import { useEffect, useRef, useState } from 'react';
import type { Asset, Candle, Snapshot, Source } from '../types';
import { demoSnapshot } from './data';
import { validateSnapshot } from './validation';
import { aggregateComplete } from './research';

export type DataSource = 'demo' | 'kraken' | 'service';
export type MarketState = { snapshot: Snapshot | null; context: Snapshot | null; busy: boolean; error: string; transport: 'demo' | 'connecting' | 'streaming' | 'polling' | 'stale' | 'paused'; observedAt: number; receivedAt: number };
const API = 'https://api.kraken.com/0/public';
export function validCandle(c: Candle) {
  return [c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) && Number.isInteger(c.time) && c.time > 0 && Math.min(c.open, c.high, c.low, c.close) > 0 && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && c.volume >= 0;
}
export function parseKrakenRows(rows: unknown, minutes: number, now: number): { candles: Candle[]; forming: Candle | null } {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Kraken returned no candle history. Retry the connection.');
  const parsed = rows.map((row): Candle => {
    if (!Array.isArray(row) || row.length < 7) throw new Error('Kraken returned an invalid candle. Retry the connection.');
    const c = { time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[6]), sentiment: null };
    if (!validCandle(c) || c.time % (minutes * 60) !== 0 || c.time > now + 60) throw new Error('Kraken returned invalid prices or timestamps. Check the device clock and retry.');
    return c;
  });
  if (parsed.some((c, i) => i > 0 && c.time <= parsed[i - 1].time)) throw new Error('Kraken history is duplicated or out of order. Retry the connection.');
  // Kraken always includes a not-yet-committed final row, even in a quiet market.
  const forming = parsed.at(-1)!;
  return { candles: parsed.slice(0, -1).filter(c => c.time + minutes * 60 <= now), forming };
}
export function mergeCandle(existing: Candle[], incoming: Candle): Candle[] {
  if (!validCandle(incoming)) return existing;
  const map = new Map(existing.map(c => [c.time, c])); map.set(incoming.time, incoming);
  return [...map.values()].sort((a, b) => a.time - b.time).slice(-1500);
}
async function krakenGet(path: string, signal: AbortSignal) {
  const response = await fetch(`${API}/${path}`, { signal });
  if (!response.ok) throw new Error(`Kraken returned HTTP ${response.status}. Retry or use the demo workspace.`);
  const body = await response.json();
  if (!Array.isArray(body.error) || body.error.length || !body.result) throw new Error(`Kraken could not load this market${body.error?.length ? `: ${body.error.join(', ')}` : '.'} Choose another asset or retry.`);
  return body.result;
}
export async function fetchKraken(asset: Asset, minutes: number, signal: AbortSignal): Promise<Snapshot> {
  const pair = `${asset === 'BTC' ? 'XBT' : asset}USD`;
  const [history, pairs, tickers] = await Promise.all([krakenGet(`OHLC?pair=${pair}&interval=${minutes}`, signal), krakenGet(`AssetPairs?pair=${pair}`, signal), krakenGet(`Ticker?pair=${pair}`, signal)]);
  const rows = Object.entries(history).find(([key]) => key !== 'last')?.[1];
  const now = Date.now() / 1000, { candles, forming } = parseKrakenRows(rows, minutes, now);
  if (!candles.length) throw new Error('No closed candles are available for this interval. Choose another interval.');
  const metadata = Object.values(pairs)[0] as { lot_decimals?: number; ordermin?: string; status?: string };
  const ticker = Object.values(tickers)[0] as { c?: string[]; p?: string[]; v?: string[]; o?: string };
  const price = Number(ticker.c?.[0]), volume = Number(ticker.v?.[1]) * Number(ticker.p?.[1]);
  if (!metadata || !Number.isInteger(metadata.lot_decimals) || !Number.isFinite(Number(metadata.ordermin)) || !Number.isFinite(price) || price <= 0 || !Number.isFinite(volume)) throw new Error('Kraken instrument metadata is incomplete. Paper entries are unavailable.');
  if (metadata.status && metadata.status !== 'online') throw new Error(`Kraken reports this market as ${metadata.status}. Choose an online market.`);
  const sources: Source[] = (['Social', 'News', 'On-chain'] as const).map(kind => ({ kind, score: null, count: 0, updatedAt: null, status: 'unavailable', detail: 'Connect the optional Pulse service for sentiment context.' }));
  return { asset, mode: 'live', venue: 'Kraken', interval: minutes, receivedAt: now, asOf: now, price, change: Number(ticker.o) > 0 ? (price / Number(ticker.o) - 1) * 100 : 0, volume, candles, forming, sources, feed: [], lotSize: 10 ** -metadata.lot_decimals!, orderMin: Number(metadata.ordermin) };
}
export function useMarket(asset: Asset, minutes: number, contextMinutes: number, source: DataSource, serviceUrl: string, paused: boolean, revision: number) {
  const [state, setState] = useState<MarketState>(() => ({ snapshot: demoSnapshot(asset, minutes), context: demoSnapshot(asset, contextMinutes), busy: false, error: '', transport: 'demo', observedAt: 0, receivedAt: 0 }));
  const generation = useRef(0);
  useEffect(() => {
    const id = ++generation.current, abort = new AbortController();
    let socket: WebSocket | undefined, refreshTimer: ReturnType<typeof setInterval> | undefined, heartbeatTimer: ReturnType<typeof setInterval> | undefined, reconnectTimer: ReturnType<typeof setTimeout> | undefined, batchTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false, attempt = 0, lastMessage = 0, reconnecting = false, loading = false, pending: Candle[] = [], data: Snapshot | null = null, lastStreamTime = 0, venueHealthy = true;
    const active = () => !disposed && id === generation.current;
    function update(patch: Partial<MarketState>) { if (active()) setState(s => ({ ...s, ...patch })); }
    if (source === 'demo') { update({ snapshot: demoSnapshot(asset, minutes), context: demoSnapshot(asset, contextMinutes), busy: false, error: '', transport: 'demo', observedAt: 0, receivedAt: 0 }); return () => { disposed = true; }; }
    if (paused) { update({ busy: false, transport: 'paused' }); return () => { disposed = true; }; }
    update({ snapshot: null, context: null, error: '', busy: true, transport: 'connecting', observedAt: 0, receivedAt: 0 });
    async function load() {
      if (loading) return;
      loading = true;
      const requestSignal = AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]);
      try {
        let snapshot: Snapshot, context: Snapshot | null = null;
        if (source === 'service') {
          const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/api/snapshot?asset=${asset}`, { signal: requestSignal });
          if (!response.ok) throw new Error(`The Pulse service returned ${response.status}. Check its URL and retry.`);
          const value: unknown = await response.json();
          if (!validateSnapshot(value, asset)) throw new Error('The service returned stale or invalid data. Check its exchange connection and retry.');
          const original = value as Snapshot;
          snapshot = { ...original, interval: minutes, venue: 'Kraken via Pulse', candles: aggregateComplete(original.candles, 5, minutes) };
          context = { ...original, interval: contextMinutes, candles: aggregateComplete(original.candles, 5, contextMinutes) };
        } else {
          [snapshot, context] = await Promise.all([fetchKraken(asset, minutes, requestSignal), fetchKraken(asset, contextMinutes, requestSignal)]);
        }
        if (!active()) return;
        data = snapshot;
        update({ snapshot, context, busy: false, error: venueHealthy ? '' : 'Kraken is not reporting normal market operation. New paper entries are paused.', receivedAt: Date.now() / 1000, observedAt: snapshot.forming?.time ?? snapshot.candles.at(-1)?.time ?? 0, transport: !venueHealthy ? 'stale' : socket?.readyState === WebSocket.OPEN ? 'streaming' : 'polling' });
        return true;
      } catch (error) {
        update({ busy: false, error: ['AbortError', 'TimeoutError'].includes((error as Error).name) ? 'The data request timed out. Retry the connection.' : (error as Error).message === 'Failed to fetch' ? 'The data feed is unreachable. Check your connection, retry, or choose demo data.' : (error as Error).message, transport: 'stale' });
        return false;
      } finally { loading = false; }
    }
    function connectStream() {
      if (!active() || source !== 'kraken' || abort.signal.aborted) return;
      socket = new WebSocket('wss://ws.kraken.com/v2');
      socket.onopen = () => { if (!active()) return; lastMessage = Date.now(); socket!.send(JSON.stringify({ method: 'subscribe', params: { channel: 'ohlc', symbol: [`${asset}/USD`], interval: minutes, snapshot: true } })); };
      socket.onmessage = event => {
        if (!active()) return;
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        lastMessage = Date.now();
        if (message.success === false) { update({ error: `The streaming subscription was rejected: ${message.error}. REST recovery remains available.`, transport: 'polling' }); socket?.close(); return; }
        if (message.channel === 'status') { venueHealthy = message.data?.[0]?.system === 'online'; if (!venueHealthy) { update({ transport: 'stale', error: 'Kraken is not reporting normal market operation. New paper entries are paused.' }); return; } }
        if (message.channel === 'ohlc' && Array.isArray(message.data)) {
          for (const row of message.data) {
            if (row.symbol !== `${asset}/USD` || row.interval !== minutes) continue;
            const c: Candle = { time: Date.parse(row.interval_begin) / 1000, open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume), sentiment: null };
            if (validCandle(c) && c.time % (minutes * 60) === 0 && c.time <= Date.now() / 1000 + 60 && c.time >= lastStreamTime) { pending.push(c); lastStreamTime = c.time; }
          }
          if (!batchTimer) batchTimer = setTimeout(() => {
            batchTimer = undefined;
            if (!data || !active() || !pending.length) { pending = []; return; }
            for (const c of pending) {
              // A later interval confirms the previous streamed bar. Same-bar updates replace, never append.
              if (data.forming && c.time > data.forming.time) data = { ...data, candles: mergeCandle(data.candles, data.forming) };
              if (c.time >= (data.forming?.time ?? 0)) data = { ...data, forming: c, price: c.close, asOf: Date.now() / 1000 };
            }
            pending = []; attempt = 0;
            update({ snapshot: data, transport: venueHealthy ? 'streaming' : 'stale', observedAt: data.forming?.time ?? 0, receivedAt: Date.now() / 1000, error: venueHealthy ? '' : 'Kraken is not reporting normal market operation. New paper entries are paused.' });
          }, 250);
        }
      };
      socket.onerror = () => { update({ transport: 'polling' }); };
      socket.onclose = () => {
        if (!active() || reconnecting) return;
        update({ transport: 'stale', error: 'Streaming disconnected. Recovering history before reconnecting.' });
        reconnecting = true;
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) * (.8 + Math.random() * .2);
        reconnectTimer = setTimeout(async () => { reconnecting = false; if (await load()) connectStream(); }, delay);
      };
    }
    void load().then(ok => { if (ok) connectStream(); });
    refreshTimer = setInterval(() => { if (!document.hidden) void load().then(ok => { if (ok && !reconnecting && (!socket || socket.readyState === WebSocket.CLOSED)) connectStream(); }); }, 30000);
    heartbeatTimer = setInterval(() => {
      if (!active()) return;
      if (socket?.readyState === WebSocket.OPEN && Date.now() - lastMessage > 10000) { update({ transport: 'stale', error: 'No transport heartbeat for 10 seconds. Recovering the market feed.' }); socket.close(); }
      else if (socket?.readyState === WebSocket.OPEN) update({ receivedAt: lastMessage / 1000 });
      else if (data && Date.now() / 1000 - data.asOf > 90) update({ transport: 'stale' });
    }, 2000);
    const onVisible = () => { if (!document.hidden) void load().then(ok => { if (ok && (!socket || socket.readyState === WebSocket.CLOSED)) connectStream(); }); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { disposed = true; abort.abort(); socket?.close(); clearInterval(refreshTimer); clearInterval(heartbeatTimer); clearTimeout(reconnectTimer); clearTimeout(batchTimer); document.removeEventListener('visibilitychange', onVisible); };
  }, [asset, minutes, contextMinutes, source, serviceUrl, paused, revision]);
  return state;
}
