import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateComplete, DEFAULT_RESEARCH, periodStart, priorLevels, researchConditions, researchIndicators, researchSignal } from '../src/lib/research';
import { appendAlert } from '../src/lib/alerts';
import { mergeCandle, parseKrakenRows } from '../src/lib/market';
import { INITIAL_PORTFOLIO, exitPosition, markPortfolio, openPosition, portfolioMetrics, sizeWithCosts, validPortfolio, type SizingInput } from '../src/lib/portfolio';
import { partitions, replay } from '../src/lib/replay';
import type { Candle } from '../src/types';
const start = Date.UTC(2026, 4, 18) / 1000;
const candles = (n: number, step = 0): Candle[] => Array.from({ length: n }, (_, i) => ({ time: start + i * 300, open: 100 + i * step, close: 100 + i * step, high: 101 + i * step, low: 99 + i * step, volume: 10, sentiment: null }));
const near = (a: number, b: number, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} vs ${b}`);
const sizing: SizingInput = { equity: 1000, freeCash: 1000, riskPct: 1, entry: 100, stop: 95, target: 110, entryFee: 1, exitFee: 1, slippageBps: 100, lotSize: .01, maxNotional: 1000, remainingRisk: 100, side: 'buy' };

test('Wilder RSI covers flat, rising, falling, warm-up and a gap', () => {
  assert.equal(researchIndicators(candles(30), 5).rsi[13], null);
  assert.equal(researchIndicators(candles(30), 5).rsi[14], 50);
  assert.equal(researchIndicators(candles(30, 1), 5).rsi.at(-1), 100);
  assert.equal(researchIndicators(candles(30, -1), 5).rsi.at(-1), 0);
  const gapped = candles(30); gapped.splice(27, 1);
  assert.equal(researchIndicators(gapped, 5).rsi.at(-1), null);
  assert.equal(researchIndicators(gapped, 5).coverage.at(-1), 2);
});
test('Wilder ATR uses the seed mean then recursive smoothing', () => {
  const bars = candles(16); bars[15].high = 109;
  const actual = researchIndicators(bars, 5).atr;
  assert.equal(actual[13], null); near(actual[14]!, 2); near(actual[15]!, (2 * 13 + 10) / 14);
});
test('RVOL excludes the current bar from the prior-20 denominator', () => {
  const bars = candles(21); bars[20].volume = 100;
  near(researchIndicators(bars, 5).rvol.at(-1)!, 10);
  assert.equal(researchIndicators(bars.map(c => ({ ...c, volume: 0 })), 5).rvol.at(-1), null);
});
test('VWAP requires complete UTC anchor coverage and positive volume', () => {
  const bars = candles(2).map((c, i) => ({ ...c, open: (i + 1) * 10, close: (i + 1) * 10, high: (i + 1) * 10 + 1, low: (i + 1) * 10 - 1, volume: (i + 1) * 10 }));
  near(researchIndicators(bars, 5).vwap.at(-1)!, 500 / 30);
  assert.equal(researchIndicators(bars.slice(1), 5).vwap[0], null);
  assert.equal(researchIndicators(bars.map(c => ({ ...c, volume: 0 })), 5).vwap[0], null);
  const nextDay = { ...bars[0], time: start + 86400, close: 50, high: 51, low: 49, open: 50 };
  near(researchIndicators([...bars, nextDay], 5).vwap.at(-1)!, 50);
  assert.equal(periodStart(start + 6 * 86400, 'week'), start);
  assert.equal(periodStart(start + 7 * 86400, 'week'), start + 7 * 86400);
});
test('MACD warms up for 130 bars; EMA first-close convention is stable', () => {
  const data = researchIndicators(candles(260, .1), 5);
  assert.equal(data.macd[128], null); assert.notEqual(data.macd[129], null);
  near(data.ema20[0], 100); near(data.ema20[1], 100 + 2 / 21 * .1);
  assert.equal(researchSignal(candles(240), 5, 'swing', DEFAULT_RESEARCH).conditions[0].met, null);
});
test('higher-interval buckets require every constituent and boundary', () => {
  const bars = candles(12);
  assert.equal(aggregateComplete(bars, 5, 15).length, 4);
  assert.equal(aggregateComplete(bars.slice(1), 5, 15).length, 3);
  const missing = bars.filter((_, i) => i !== 4);
  assert.equal(aggregateComplete(missing, 5, 15).length, 3);
  assert.equal(aggregateComplete(bars, 5, 1).length, 0);
});
test('prior-day levels require a full day of bars', () => {
  const bars = candles(300); const levels = priorLevels(bars, 5, 'session');
  assert.deepEqual(levels, { high: 101, low: 99, close: 100 });
  assert.equal(priorLevels(bars.slice(1), 5, 'session'), null);
});
test('a price/volume setup is a new closed-bar event and stale inputs block it', () => {
  const bars = candles(200); bars[198] = { ...bars[198], open: 99, close: 99, low: 98, high: 100 }; bars[199] = { ...bars[199], open: 100.5, close: 100.5, high: 101.5, low: 99.5, volume: 100 };
  const signal = researchSignal(bars, 5, 'intraday', DEFAULT_RESEARCH);
  assert.equal(signal.qualifies, true);
  assert.deepEqual(signal.conditions, researchConditions(bars, signal.data, 199, 'intraday', DEFAULT_RESEARCH));
  assert.equal(researchSignal(bars, 5, 'intraday', DEFAULT_RESEARCH, false).qualifies, false);
  const later = [...bars, { ...bars[199], time: bars[199].time + 300 }];
  assert.equal(researchSignal(later, 5, 'intraday', DEFAULT_RESEARCH).conditions[0].met, false);
});
test('Kraken final row remains forming and malformed / reordered data is rejected', () => {
  const rows = candles(3).map(c => [c.time, c.open, c.high, c.low, c.close, c.close, c.volume, 1]);
  const actual = parseKrakenRows(rows, 5, start + 900);
  assert.equal(actual.candles.length, 2); assert.equal(actual.forming?.time, start + 600);
  assert.throws(() => parseKrakenRows([rows[1], rows[0]], 5, start + 900), /order/);
  assert.throws(() => parseKrakenRows([[start, 100, 90, 99, 100, 100, 10]], 5, start + 900), /invalid/);
});
test('stream bars deduplicate by timestamp and ignore malformed price values', () => {
  const bars = candles(2); const next = mergeCandle(bars, { ...bars[1], close: 100.5 });
  assert.equal(next.length, 2); assert.equal(next[1].close, 100.5);
  assert.equal(mergeCandle(next, { ...bars[1], close: NaN }), next);
});
test('sizing includes two-sided fees/slippage and rounds down', () => {
  const result = sizeWithCosts(sizing);
  near(result.entryFill, 101); near(result.lossPerUnit, 8.9005); near(result.quantity, 1.12);
  assert.ok(result.plannedLoss <= 10); near(result.ratio, 5.801 / 8.9005);
  const capped = sizeWithCosts({ ...sizing, freeCash: 50 }); assert.ok(capped.cashRequired <= 50); assert.ok(capped.capped);
  assert.throws(() => sizeWithCosts({ ...sizing, stop: 101 }), /stop/);
});
test('short sizing reverses slippage and validates target direction', () => {
  const result = sizeWithCosts({ ...sizing, side: 'sell', stop: 105, target: 90 });
  near(result.entryFill, 99); near(result.lossPerUnit, 9.1005);
  assert.throws(() => sizeWithCosts({ ...sizing, side: 'sell' }), /stop/);
});
test('ledger reserves cash, apportions fees on partial exits and reconciles on import', () => {
  const initial = structuredClone(INITIAL_PORTFOLIO);
  const opened = openPosition(initial, 'BTC', sizing, start, 'Test rule', 5);
  assert.equal(opened.positions.length, 1); assert.ok(opened.cash < initial.cash); assert.ok(validPortfolio(opened));
  const p = opened.positions[0], half = exitPosition(opened, p.id, .5, 110, start + 1, 'Half');
  near(half.positions[0].quantity, p.quantity / 2); near(half.positions[0].entryFee, p.entryFee / 2); assert.ok(validPortfolio(half));
  const closed = exitPosition(half, p.id, 1, 110, start + 2, 'Close'); assert.equal(closed.positions.length, 0); assert.ok(validPortfolio(closed));
  assert.equal(validPortfolio({ ...closed, cash: closed.cash + 1 }), false);
});
test('portfolio caps block entries while daily-loss lockout still allows exits', () => {
  const opened = openPosition(structuredClone(INITIAL_PORTFOLIO), 'BTC', { ...sizing, riskPct: 10 }, start, 'Test', 5);
  assert.ok(portfolioMetrics(opened).openRisk <= INITIAL_PORTFOLIO.initialEquity * .005);
  const locked = { ...opened, dayStartEquity: 20000 };
  assert.equal(portfolioMetrics(locked).locked, true);
  assert.throws(() => openPosition(locked, 'ETH', sizing, start + 1, 'Test', 5), /Daily loss/);
  assert.equal(exitPosition(locked, locked.positions[0].id, 1, 100, start + 1, 'Close').positions.length, 0);
});
test('simulated gaps can exceed planned risk and stop wins a same-bar collision', () => {
  const opened = openPosition(structuredClone(INITIAL_PORTFOLIO), 'BTC', { ...sizing, entryFee: 0, exitFee: 0, slippageBps: 0 }, start, 'Test', 5);
  const bar = { ...candles(1)[0], time: start + 300, open: 80, high: 120, low: 70, close: 100 };
  const closed = markPortfolio(opened, 'BTC', [bar], 100, start + 600, 5);
  assert.equal(closed.positions.length, 0); assert.equal(closed.fills.at(-1)?.price, 80); assert.match(closed.fills.at(-1)!.reason, /Stop/);
  assert.ok(-closed.fills.at(-1)!.pnl > opened.positions[0].plannedRisk);
});
test('forming mark updates do not prevent a later finalized candle from triggering its stop', () => {
  const opened = openPosition(structuredClone(INITIAL_PORTFOLIO), 'BTC', sizing, start, 'Test', 5);
  const tick = markPortfolio(opened, 'BTC', [], 100, start + 601, 5);
  const bar = { ...candles(1)[0], time: start + 300, low: 90 };
  const closed = markPortfolio(tick, 'BTC', [bar], 100, start + 602, 5);
  assert.equal(closed.positions.length, 0);
});
test('alerts persist one event per closed bar despite reconnects', () => {
  const a = { id: 'rule:BTC:5:100', time: 100, asset: 'BTC' as const, interval: 5, workspace: 'intraday' as const, mode: 'demo' as const, rule: 'reclaim', conditions: [] };
  const result = appendAlert([], a); assert.equal(appendAlert(result, a), result);
  assert.equal(appendAlert(result, { ...a, id: 'rule:BTC:5:400', time: 400 }).length, 2);
});
test('chronological partitions do not overlap and preserve prior warm-up', () => {
  const split = partitions(1000, 'intraday');
  assert.equal(split[0].start, 131); assert.equal(split[0].end, split[1].start); assert.equal(split[1].end, split[2].start); assert.equal(split[2].end, 1000);
  assert.throws(() => partitions(150, 'swing'), /Load/);
});
test('replay signal uses previous close, conservative exits and cost-matched benchmark', () => {
  const bars = candles(300); bars[198] = { ...bars[198], open: 99, close: 99, low: 98, high: 100 }; bars[199] = { ...bars[199], open: 100.5, close: 100.5, high: 101.5, low: 99.5, volume: 100 }; bars[200] = { ...bars[200], low: 70, high: 130 };
  const config = { capital: 10000, fee: .1, slippageBps: 5, riskPct: .5, rewardR: 2, assetCap: 25 };
  const result = replay(bars, 5, 'intraday', DEFAULT_RESEARCH, config, 150, 250);
  assert.equal(result.trades.length, 1); assert.equal(result.trades[0].entryTime, bars[200].time); assert.equal(result.trades[0].reason, 'Stop loss'); assert.ok(result.trades[0].pnl < 0); assert.ok(result.benchmark < 0);
  const modifiedFuture = bars.map((c, i) => i >= 250 ? { ...c, close: c.close * 2 } : c);
  assert.deepEqual(replay(modifiedFuture, 5, 'intraday', DEFAULT_RESEARCH, config, 150, 250), result);
});
