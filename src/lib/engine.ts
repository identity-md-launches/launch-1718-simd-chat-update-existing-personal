import type { BacktestConfig, BacktestResult, Candle, Snapshot, SourceKind, Strategy, Trade } from '../types';

export const DEFAULT_STRATEGY: Strategy = { name: 'Sentiment momentum', buy: 65, sell: 35, maxRsi: 75, weights: { Social: 45, News: 35, 'On-chain': 20 }, stop: 2, target: 4, risk: 1 };
export const money = (n: number, digits = 2) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
export const compact = (n: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
export const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
export const timeLabel = (n: number) => new Date(n * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
export const dateLabel = (n: number) => new Date(n * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  return values.reduce<number[]>((out, value, i) => { out.push(i ? value * k + out[i - 1] * (1 - k) : value); return out; }, []);
}
export function rsi(candles: Candle[], period = 14): (number | null)[] {
  let gain = 0, loss = 0;
  return candles.map((c, i) => {
    if (!i) return null;
    const delta = c.close - candles[i - 1].close;
    if (i <= period) { gain += Math.max(0, delta) / period; loss += Math.max(0, -delta) / period; }
    else { gain = (gain * (period - 1) + Math.max(0, delta)) / period; loss = (loss * (period - 1) + Math.max(0, -delta)) / period; }
    if (i < period) return null;
    return !gain && !loss ? 50 : !loss ? 100 : 100 - 100 / (1 + gain / loss);
  });
}
export function indicators(candles: Candle[]) {
  let value = 0, volume = 0, day = -1;
  const vwap = candles.map(c => {
    const nextDay = Math.floor(c.time / 86400);
    if (nextDay !== day) { value = 0; volume = 0; day = nextDay; }
    value += (c.high + c.low + c.close) / 3 * c.volume; volume += c.volume;
    return volume ? value / volume : c.close;
  });
  const closes = candles.map(c => c.close), fast = ema(closes, 12), slow = ema(closes, 26);
  const macd = fast.map((v, i) => v - slow[i]), signal = ema(macd, 9);
  return { vwap, rsi: rsi(candles), macd, signal, histogram: macd.map((v, i) => v - signal[i]) };
}
export function aggregateCandles(candles: Candle[], minutes: number): Candle[] {
  const groups = new Map<number, Candle>();
  for (const c of candles) {
    const time = Math.floor(c.time / (minutes * 60)) * minutes * 60;
    const prev = groups.get(time);
    if (!prev) groups.set(time, { ...c, time });
    else { prev.high = Math.max(prev.high, c.high); prev.low = Math.min(prev.low, c.low); prev.close = c.close; prev.volume += c.volume; prev.sentiment = c.sentiment; }
  }
  return [...groups.values()];
}
export function aggregateSentiment(snapshot: Snapshot, weights: Record<SourceKind, number>) {
  let total = 0, weighted = 0, covered = 0;
  const requested = Object.values(weights).filter(w => w > 0).length;
  for (const s of snapshot.sources) {
    const fresh = s.updatedAt !== null && snapshot.asOf - s.updatedAt <= 900 && s.updatedAt <= snapshot.asOf + 60;
    if (s.status === 'ready' && s.score !== null && fresh && weights[s.kind] > 0) { total += weights[s.kind]; weighted += s.score * weights[s.kind]; covered++; }
  }
  return { score: total > 0 ? Math.round(weighted / total) : null, covered, requested, complete: requested > 0 && covered === requested };
}
export function evaluate(snapshot: Snapshot, strategy: Strategy, now = Date.now() / 1000) {
  const sentiment = aggregateSentiment(snapshot, strategy.weights);
  const strength = rsi(snapshot.candles).at(-1);
  const stale = snapshot.mode === 'live' && now - snapshot.asOf > 120;
  if (stale || !sentiment.complete || sentiment.score === null || strength == null) return { ...sentiment, action: 'Wait' as const, reason: stale ? 'Live data is stale. Refresh before reviewing a trade.' : 'Waiting for every enabled source and enough price history.', rsi: strength };
  if (sentiment.score <= strategy.sell) return { ...sentiment, action: 'Sell' as const, reason: `Sentiment is at or below your ${strategy.sell} sell threshold.`, rsi: strength };
  if (sentiment.score >= strategy.buy && strength <= strategy.maxRsi) return { ...sentiment, action: 'Buy' as const, reason: `Sentiment exceeds ${strategy.buy} and RSI is below ${strategy.maxRsi}.`, rsi: strength };
  return { ...sentiment, action: 'Hold' as const, reason: strength > strategy.maxRsi ? 'RSI is above your entry ceiling. Wait for momentum to cool.' : 'Sentiment is between your buy and sell thresholds.', rsi: strength };
}
export function validateStrategy(s: Strategy): string | null {
  if (!s.name.trim()) return 'Enter a strategy name.';
  if (![s.buy, s.sell, s.maxRsi, s.stop, s.target, s.risk, ...Object.values(s.weights)].every(Number.isFinite)) return 'Enter a number in every numeric field.';
  if (s.sell < 0 || s.buy > 100 || s.sell >= s.buy) return 'Set the sell threshold below the buy threshold, between 0 and 100.';
  if (s.maxRsi < 1 || s.maxRsi > 100) return 'Set the RSI ceiling between 1 and 100.';
  if (Object.values(s.weights).some(w => w < 0 || w > 100) || Object.values(s.weights).reduce((a, b) => a + b, 0) <= 0) return 'Enable at least one source with a weight between 1 and 100.';
  if (s.stop <= 0 || s.stop > 50 || s.target <= 0 || s.target > 100 || s.risk <= 0 || s.risk > 10) return 'Use a stop of 0–50%, a target of 0–100%, and risk of 0–10%, all above zero.';
  return null;
}
export function sizePosition(capital: number, riskPct: number, entry: number, stop: number, target: number, side: 'buy' | 'sell' = 'buy') {
  if (![capital, riskPct, entry, stop, target].every(Number.isFinite) || capital <= 0 || riskPct <= 0 || riskPct > 10 || entry <= 0 || stop <= 0 || target <= 0) throw new Error('Enter positive values and account risk of at most 10%.');
  if (side === 'buy' ? stop >= entry || target <= entry : stop <= entry || target >= entry) throw new Error(side === 'buy' ? 'For a long position, set the stop below entry and the target above entry.' : 'For a short position, set the stop above entry and the target below entry.');
  const distance = Math.abs(entry - stop), riskBudget = capital * riskPct / 100;
  const quantity = Math.min(riskBudget / distance, capital / entry);
  return { quantity, notional: quantity * entry, riskBudget, maxLoss: quantity * distance, reward: quantity * Math.abs(target - entry), ratio: Math.abs(target - entry) / distance, capped: riskBudget / distance > capital / entry };
}
export function suggestedStop(candles: Candle[], entry: number, side: 'buy' | 'sell') {
  if (!Number.isFinite(entry) || entry <= 0) return null;
  const last = candles.slice(-15);
  if (last.length < 15) return null;
  const atr = last.slice(1).reduce((sum, c, i) => sum + Math.max(c.high - c.low, Math.abs(c.high - last[i].close), Math.abs(c.low - last[i].close)), 0) / 14;
  const stop = entry + (side === 'buy' ? -1 : 1) * atr * 2;
  return stop > 0 ? stop : null;
}
export function backtest(candles: Candle[], config: BacktestConfig): BacktestResult {
  if (candles.length < 30) throw new Error('Use at least 30 candles to allow indicators to warm up.');
  const error = validateStrategy({ ...DEFAULT_STRATEGY, ...config });
  if (error) throw new Error(error);
  if (!Number.isFinite(config.capital) || config.capital <= 0 || !Number.isFinite(config.fee) || config.fee < 0 || config.fee > 5 || !Number.isFinite(config.slippage) || config.slippage < 0 || config.slippage > 5) throw new Error('Use positive capital and fees/slippage between 0% and 5%.');
  let cash = config.capital, peak = cash, maxDrawdown = 0;
  const equity: BacktestResult['equity'] = [], trades: Trade[] = [], strength = rsi(candles);
  let position: { entry: number; quantity: number; entryTime: number; fee: number; stop: number; target: number } | null = null;
  const slip = config.slippage / 100, fee = config.fee / 100;
  function close(price: number, c: Candle, reason: string) {
    if (!position) return;
    const exit = price * (1 - slip), proceeds = position.quantity * exit;
    const pnl = proceeds * (1 - fee) - position.quantity * position.entry - position.fee;
    cash += proceeds * (1 - fee);
    trades.push({ entryTime: position.entryTime, exitTime: c.time, entry: position.entry, exit, quantity: position.quantity, pnl, reason, equity: cash });
    position = null;
  }
  for (let i = 15; i < candles.length; i++) {
    const c = candles[i], prev = candles[i - 1];
    // A closed previous bar's score triggers a fill at the next open. Never use future scores.
    if (position && prev.sentiment !== null && prev.sentiment <= config.sell) close(c.open, c, 'Sentiment exit');
    else if (!position && cash > 0 && prev.sentiment !== null && prev.sentiment >= config.buy && strength[i - 1] !== null && strength[i - 1]! <= config.maxRsi) {
      const entry = c.open * (1 + slip), stop = entry * (1 - config.stop / 100);
      const quantity = Math.min(cash * config.risk / 100 / (entry - stop), cash / (entry * (1 + fee)));
      const cost = quantity * entry;
      position = { entry, stop, quantity, entryTime: c.time, target: entry * (1 + config.target / 100), fee: cost * fee };
      cash -= cost * (1 + fee);
    }
    // Conservative stop-first ordering when both levels are touched in one candle.
    if (position && c.low <= position.stop) close(Math.min(c.open, position.stop), c, 'Stop loss');
    else if (position && c.high >= position.target) close(Math.max(c.open, position.target), c, 'Take profit');
    if (position && i === candles.length - 1) close(c.close, c, 'End of period');
    const marked = cash + (position ? position.quantity * c.close * (1 - fee) : 0);
    peak = Math.max(peak, marked); maxDrawdown = Math.max(maxDrawdown, (peak - marked) / peak * 100);
    equity.push({ time: c.time, value: marked });
  }
  return { trades, equity, returnPct: (cash / config.capital - 1) * 100, maxDrawdown, winRate: trades.length ? trades.filter(t => t.pnl > 0).length / trades.length * 100 : 0, finalEquity: cash, benchmark: (candles.at(-1)!.close / candles[15].open - 1) * 100, bars: candles.length };
}
export function parseCsv(text: string): Candle[] {
  const rows = text.trim().replace(/^\uFEFF/, '').split(/\r?\n/);
  if (rows[0].trim() !== 'time,open,high,low,close,volume,sentiment') throw new Error('Use the header: time,open,high,low,close,volume,sentiment');
  if (rows.length > 25001) throw new Error('Import at most 25,000 candles.');
  const candles = rows.slice(1).map((row, i): Candle => {
    const fields = row.split(',');
    if (fields.length !== 7 || fields.some((v, idx) => idx < 6 && !v.trim())) throw new Error(`Row ${i + 2}: enter all OHLCV values.`);
    const [time, open, high, low, close, volume, score] = fields.map(Number);
    const sentiment = fields[6].trim() ? score : null;
    if (![time, open, high, low, close, volume].every(Number.isFinite) || time < 946684800 || time > 4102444800 || !Number.isInteger(time) || Math.min(open, high, low, close) <= 0 || volume < 0 || high < Math.max(open, close) || low > Math.min(open, close) || (sentiment !== null && (!Number.isFinite(sentiment) || sentiment < 0 || sentiment > 100))) throw new Error(`Row ${i + 2}: check Unix seconds, positive OHLC prices, volume and sentiment (0–100).`);
    return { time, open, high, low, close, volume, sentiment };
  });
  if (candles.length < 30 || candles.some((c, i) => i > 0 && c.time <= candles[i - 1].time)) throw new Error('Use at least 30 candles in strictly increasing timestamp order.');
  return candles;
}
export function download(name: string, content: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
