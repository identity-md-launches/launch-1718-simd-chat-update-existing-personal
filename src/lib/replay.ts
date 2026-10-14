import type { BacktestResult, Candle, Trade } from '../types';
import { researchConditions, researchIndicators, type ResearchSettings, type Workspace } from './research';
import { sizeWithCosts } from './portfolio';
export type ReplayConfig = { capital: number; fee: number; slippageBps: number; riskPct: number; rewardR: number; assetCap: number };
export type ReplayResult = BacktestResult & { expectancy: number; profitFactor: number | null; turnover: number; exposure: number; costs: number; start: number; end: number; totalSignals: number };
/** Warm-up precedes the evaluation range. A previous closed-bar signal fills at next open. */
export function replay(candles: Candle[], minutes: number, workspace: Workspace, settings: ResearchSettings, config: ReplayConfig, start: number, end: number): ReplayResult {
  if (!Object.values(config).every(Number.isFinite) || config.capital <= 0 || config.fee < 0 || config.fee > 5 || config.slippageBps < 0 || config.slippageBps > 500 || config.riskPct <= 0 || config.riskPct > 10 || config.rewardR <= 0 || config.rewardR > 10 || config.assetCap <= 0 || config.assetCap > 100) throw new Error('Use positive capital, risk up to 10%, reward up to 10R, fees up to 5% and slippage up to 500 bps.');
  if (start < 1 || end > candles.length || end - start < 20) throw new Error('At least 20 evaluation bars and prior warm-up history are required.');
  const data = researchIndicators(candles, minutes, settings.vwapPeriod, settings.rsiPeriod), fee = config.fee / 100, slip = config.slippageBps / 10000;
  let cash = config.capital, peak = cash, maxDrawdown = 0, costs = 0, notional = 0, exposed = 0, totalSignals = 0;
  const equity: BacktestResult['equity'] = [], trades: Trade[] = [];
  let position: { entry: number; quantity: number; entryTime: number; fee: number; stop: number; target: number } | null = null;
  function close(quoted: number, bar: Candle, reason: string) {
    if (!position) return;
    const exit = quoted * (1 - slip), exitFee = position.quantity * exit * fee;
    const pnl = position.quantity * (exit - position.entry) - position.fee - exitFee;
    cash += position.quantity * exit - exitFee;
    costs += exitFee + position.quantity * (quoted - exit); notional += position.quantity * exit;
    trades.push({ entryTime: position.entryTime, exitTime: bar.time, entry: position.entry, exit, quantity: position.quantity, pnl, reason, equity: cash });
    position = null;
  }
  for (let i = start; i < end; i++) {
    const bar = candles[i], previous = candles[i - 1];
    const gap = bar.time !== previous.time + minutes * 60;
    if (position && gap) close(bar.open, bar, 'Coverage gap: first observed open');
    const condition = researchConditions(candles, data, i - 1, workspace, settings), signal = condition.length > 0 && condition.every(c => c.met === true);
    if (signal) totalSignals++;
    if (!position && !gap && signal && data.atr[i - 1] != null) {
      const distance = data.atr[i - 1]! * settings.atrMultiplier, stop = bar.open - distance, target = bar.open + distance * config.rewardR;
      if (stop > 0 && cash > 0) {
        const size = sizeWithCosts({ equity: cash, freeCash: cash, riskPct: config.riskPct, entry: bar.open, stop, target, entryFee: config.fee, exitFee: config.fee, slippageBps: config.slippageBps, lotSize: .00000001, maxNotional: cash * config.assetCap / 100, remainingRisk: cash * config.riskPct / 100, side: 'buy' });
        if (size.quantity > 0 && size.ratio > 0) {
          const entryFee = size.notional * fee;
          position = { entry: size.entryFill, entryTime: bar.time, quantity: size.quantity, fee: entryFee, stop, target };
          cash -= size.cashRequired; costs += entryFee + size.quantity * (size.entryFill - bar.open); notional += size.notional;
        }
      }
    }
    if (position) exposed++;
    if (position && bar.low <= position.stop) close(Math.min(bar.open, position.stop), bar, 'Stop loss');
    else if (position && bar.high >= position.target) close(Math.max(bar.open, position.target), bar, 'Take profit');
    if (position && i === end - 1) close(bar.close, bar, 'End of evaluation');
    const marked = cash + (position ? position.quantity * bar.close * (1 - fee) : 0);
    peak = Math.max(peak, marked); maxDrawdown = Math.max(maxDrawdown, (peak - marked) / peak * 100); equity.push({ time: bar.time, value: marked });
  }
  const wins = trades.filter(t => t.pnl > 0), grossProfit = wins.reduce((s, t) => s + t.pnl, 0), grossLoss = -trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0);
  const benchmarkQuantity = config.capital / (candles[start].open * (1 + slip) * (1 + fee)), benchmarkEnd = benchmarkQuantity * candles[end - 1].close * (1 - slip) * (1 - fee);
  return { trades, equity, returnPct: (cash / config.capital - 1) * 100, maxDrawdown, winRate: trades.length ? wins.length / trades.length * 100 : 0, finalEquity: cash, benchmark: (benchmarkEnd / config.capital - 1) * 100, bars: end - start, expectancy: trades.length ? (cash - config.capital) / trades.length : 0, profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null, turnover: notional / config.capital, exposure: exposed / (end - start) * 100, costs, start: candles[start].time, end: candles[end - 1].time, totalSignals };
}
export function partitions(length: number, workspace: Workspace) {
  const warmup = workspace === 'swing' ? 251 : 131, available = length - warmup;
  if (available < 100) throw new Error(`Load at least ${warmup + 100} candles for warm-up and chronological evaluation.`);
  const first = warmup + Math.floor(available * .6), second = warmup + Math.floor(available * .8);
  return [{ name: 'Development · 60%', start: warmup, end: first }, { name: 'Validation · 20%', start: first, end: second }, { name: 'Final test · 20%', start: second, end: length }];
}
