import { chromium, webkit } from 'playwright';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createPreview } from '../scripts/preview.mjs';

await mkdir('artifacts', { recursive: true });
await mkdir('test/scratch', { recursive: true });
const report = { checks: [], viewports: [], accessibility: [], contrast: [], errors: [], resourceErrors: [], limitations: ['Browser emulation is not a physical-device or screen-reader test.', 'CSS text enlargement is separate from native browser zoom.', 'Public-feed fixtures test failure, recovery and stream behavior; actual provider reachability is recorded separately.'] };
const pass = message => { report.checks.push(message); console.log(`PASS ${message}`); };
const preview = await createPreview();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(preview.origin)) report.resourceErrors.push(`${r.status()} ${r.url()}`); });
  async function nav(hash) { await page.evaluate(value => { location.hash = value; }, hash); await expect(page).toHaveURL(new RegExp(`#${hash}$`)); await page.getByRole('heading', { level: 1 }).waitFor(); }
  async function audit(label) {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const violations = result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, message: n.failureSummary })) }));
    report.accessibility.push({ label, violations }); assert.deepEqual(violations, [], `${label}: accessibility violations`);
  }
  async function bounds(label) { const value = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })); report.viewports.push({ label, ...value }); assert.ok(value.scroll <= value.width, `${label}: ${JSON.stringify(value)}`); }
  await page.goto(preview.url); await page.evaluate(() => document.fonts.ready); assert.ok(await page.evaluate(() => document.fonts.check('500 14px "Inter Variable"')));
  await expect(page).toHaveTitle('Pulse | Personal trading workspace');
  for (const asset of ['favicon.svg', 'og-image.png']) assert.equal((await page.request.get(preview.url + asset)).status(), 200);
  assert.equal(await page.locator('meta[name="description"]').count(), 1); assert.equal(await page.locator('meta[property="og:title"]').count(), 1); assert.equal(await page.locator('meta[property="og:image"]').count(), 1);
  await audit('dashboard 1440');
  report.contrast = await page.evaluate(() => {
    const parse = color => color.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = color => parse(color).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    return [['Body text', '.condition-list strong', '.setup-panel'], ['Secondary text', '.metric-label', '.metric'], ['Primary action', '.button.primary', '.button.primary']].map(([label, text, background]) => {
      const foreground = getComputedStyle(document.querySelector(text)).color, back = getComputedStyle(document.querySelector(background)).backgroundColor;
      const a = lum(foreground), b = lum(back); return {label, foreground, background: back, ratio: Number(((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toFixed(2))};
    });
  });

  await page.screenshot({ path: 'artifacts/dashboard-desktop.jpg', fullPage: true, type: 'jpeg', quality: 80 });
  pass('Production export, relative subpath assets, local font and social metadata load');
  const snapshotDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export', exact: true }).click();
  const exported = JSON.parse(await readFile(await (await snapshotDownload).path(), 'utf8'));
  assert.equal(exported.schemaVersion, 2); assert.equal(exported.snapshot.asset, 'BTC'); assert.equal(exported.snapshot.mode, 'demo'); assert.equal(exported.snapshot.interval, 5);
  assert.equal(exported.analysis.conditions.length, 3);
  pass('Analysis export retains provenance, exact closed candles, interval and rule parameters');
  await page.getByRole('button', { name: 'Review setup', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toBeFocused();
  pass('Native review dialog supports keyboard dismissal and restores focus');
  await page.getByRole('button', { name: 'RSI', exact: true }).click(); await expect(page.getByRole('img', { name: /^RSI / })).toBeVisible();
  await page.getByRole('button', { name: 'MACD', exact: true }).click(); await expect(page.getByRole('img', { name: /^MACD / })).toBeVisible();
  await page.getByRole('button', { name: '15m', exact: true }).click(); await expect(page.getByRole('button', { name: '15m', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Inspect previous candle' }).focus(); await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Edit indicator settings' }).click();
  await page.getByLabel('Relative volume threshold').fill('2.5'); await page.getByRole('button', { name: 'Save indicators' }).click();
  await expect(page.locator('.condition-list')).toContainText('2.5');
  await page.getByRole('button', { name: 'Swing', exact: true }).click(); await expect(page.getByRole('button', { name: '4h', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.setup-state')).toContainText('Trend continuation');
  await page.getByRole('button', { name: 'Intraday', exact: true }).click(); await expect(page.getByRole('button', { name: '15m', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload(); await expect(page.locator('.condition-list')).toContainText('2.5'); await expect(page.getByRole('button', { name: 'RSI', exact: true })).toHaveAttribute('aria-pressed', 'true');
  pass('Separate workspaces preserve interval, overlays and indicator settings after switching and reload');
  await page.keyboard.press('/'); await page.getByLabel('Search assets').fill('missing asset'); await expect(page.getByText(/No assets match/)).toBeVisible();
  await page.getByLabel('Search assets').fill('Solana'); await page.getByRole('button', { name: 'Solana SOL/USD' }).click(); await expect(page.getByLabel('Selected market')).toHaveValue('SOL');
  await page.getByRole('button', { name: '5m', exact: true }).click();
  const solDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export', exact: true }).click(); const sol = JSON.parse(await readFile(await (await solDownload).path(), 'utf8')).snapshot;
  const last = sol.candles.at(-1), format = value => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  await expect(page.locator('.chart-legend b')).toHaveText([last.open, last.high, last.low, last.close].map(format));
  await page.getByLabel('Selected market').selectOption('BTC');
  pass('Market search, empty recovery, symbol linking and exact OHLC text work');
  await nav('sentiment'); await page.getByRole('button', { name: 'News', exact: true }).click(); await expect(page.locator('.feed-item')).toHaveCount(2);
  await page.getByLabel('Search sentiment activity').fill('nothing-matches'); await expect(page.getByText('No matching activity')).toBeVisible(); await page.getByRole('button', { name: 'Clear filters' }).click(); await expect(page.locator('.feed-item')).toHaveCount(6); await audit('sentiment');
  pass('Sentiment source filters, search and empty-state recovery work');
  await nav('signals'); await page.getByLabel('Buy at or above').fill('30'); await page.getByRole('button', { name: 'Save strategy', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('below the buy threshold');
  await page.getByLabel('Buy at or above').fill('90'); await page.getByRole('button', { name: 'Save strategy', exact: true }).click(); await page.reload(); await expect(page.getByLabel('Buy at or above')).toHaveValue('90'); await audit('signals');
  pass('Legacy sentiment rules reject invalid thresholds and persist valid edits');
  await nav('risk'); await page.getByLabel('Entry price (USD)').fill('100'); await page.getByLabel('Stop loss (USD)', { exact: true }).fill('105'); await page.getByLabel('Take profit (USD)').fill('110');
  await page.getByRole('button', { name: 'Calculate position' }).click(); await expect(page.getByRole('alert')).toContainText('stop below entry');
  await page.getByLabel('Stop loss (USD)', { exact: true }).fill('95'); await page.getByRole('button', { name: 'Calculate position' }).click(); await expect(page.locator('.risk-results')).toContainText('Net reward / risk');
  await page.getByRole('button', { name: 'Short scenario' }).click(); await page.getByRole('button', { name: 'Calculate position' }).click(); await expect(page.locator('.risk-results')).toBeVisible(); await audit('risk calculated');
  pass('Cost-aware calculator validates direction and calculates long and short scenarios');
  await nav('overview'); await page.getByRole('button', { name: 'Plan paper trade' }).click(); await audit('paper ticket');
  await page.getByLabel('I understand this uses simulated funds stored in this browser.').check(); await page.getByRole('button', { name: 'Open paper position', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Position opened' })).toBeVisible(); await page.getByRole('button', { name: 'View paper portfolio' }).click();
  await expect(page.locator('.position-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close 50%', exact: true }).click(); await expect(page.locator('.position-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close position', exact: true }).click(); await expect(page.locator('.position-row')).toHaveCount(0); await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.reload(); await expect(page.locator('tbody tr')).toHaveCount(3);
  const ledgerDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export ledger' }).click(); const ledgerText = await readFile(await (await ledgerDownload).path(), 'utf8'); const ledger = JSON.parse(ledgerText); assert.equal(ledger.version, 2); assert.equal(ledger.fills.length, 3); assert.ok(ledger.cash < 10000);
  await page.getByLabel('Import paper portfolio').setInputFiles({ name: 'ledger.json', mimeType: 'application/json', buffer: Buffer.from(ledgerText) }); await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('button', { name: 'Replace paper ledger' }).click(); await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.getByLabel('Import paper portfolio').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...ledger, cash: ledger.cash + 5 })) }); await expect(page.getByRole('alert')).toContainText('do not reconcile');
  await page.getByLabel('Daily loss limit (%)').fill('.01'); await page.getByRole('button', { name: 'Save risk limits' }).click();
  await page.getByRole('button', { name: 'Review paper trade', exact: true }).click(); await page.getByLabel('I understand this uses simulated funds stored in this browser.').check(); await page.getByRole('button', { name: 'Open paper position', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Daily loss limit'); await page.keyboard.press('Escape');
  await audit('portfolio');
  pass('Paper lifecycle reserves cash, supports partial/full exits, persists, round-trips ledger and enforces loss lockout');
  await nav('backtest'); await page.getByRole('button', { name: 'Run evaluation', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Chronological evaluation' })).toBeVisible(); await expect(page.getByText('Return at 2× fees / slippage')).toBeVisible();
  const hiddenDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export evaluation' }).click(); const hiddenEvaluation = JSON.parse(await readFile(await (await hiddenDownload).path(), 'utf8')); assert.equal(hiddenEvaluation.finalTestRevealed, false); assert.equal(hiddenEvaluation.results.length, 2);
  await page.getByRole('button', { name: 'Final test · 20%', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Final test is hidden' })).toBeVisible(); await page.getByRole('button', { name: 'Reveal final test' }).click(); await expect(page.getByText(/final test has been viewed/)).toBeVisible();
  const evaluationDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export evaluation' }).click(); const evaluation = JSON.parse(await readFile(await (await evaluationDownload).path(), 'utf8')); assert.equal(evaluation.results.length, 3); assert.ok(evaluation.results.every(p => Number.isFinite(p.result.benchmark)));
  await page.getByLabel('Import research candles').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('bad,header\n1,2') }); await expect(page.getByRole('alert')).toContainText('Use the header');
  await audit('strategy lab results'); await page.screenshot({ path: 'artifacts/strategy-lab.jpg', fullPage: true, type: 'jpeg', quality: 75 });
  pass('Research evaluation runs all chronological windows, guards final-test visibility and exports cost sensitivity');
  await nav('overview'); await page.getByRole('button', { name: '5m', exact: true }).click();
  await page.getByRole('button', { name: 'RSI', exact: true }).click(); await page.getByRole('button', { name: 'MACD', exact: true }).click();
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const hash of ['overview', 'portfolio', 'sentiment', 'signals', 'backtest', 'risk', 'connections', 'research', 'guide']) { await nav(hash); await bounds(`${hash} ${width}`); }
  }
  await page.setViewportSize({ width: 390, height: 844 }); await nav('overview'); await page.evaluate(() => scrollTo(0, 0));
  const first = await page.evaluate(() => ({ chartTop: document.querySelector('.price-chart').getBoundingClientRect().top, actionBottom: [...document.querySelectorAll('button')].find(b => b.textContent.includes('Review setup')).getBoundingClientRect().bottom }));
  assert.ok(first.chartTop < 700 && first.actionBottom < 844, JSON.stringify(first));
  for (const label of await page.locator('.chart-legend > span').all()) await expect(label).toBeVisible();
  await page.screenshot({ path: 'artifacts/dashboard-mobile.jpg', type: 'jpeg', quality: 85 }); await audit('dashboard 390');
  await page.getByRole('button', { name: 'Open navigation' }).click(); await page.getByRole('dialog').getByRole('link', { name: 'Risk calculator' }).click(); await expect(page.getByRole('heading', { name: 'Risk calculator', exact: true })).toBeVisible();
  await page.addStyleTag({ content: 'html { font-size: 32px !important; }' }); await bounds('risk text enlarged 200%');
  await page.reload(); await nav('overview'); await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.evaluate(() => [...document.getAnimations()].filter(a => a.effect?.getComputedTiming().iterations === Infinity).length), 0);
  pass('Nine routes reflow at 320/390/768/1024/1440, phone first screen exposes chart/action, mobile navigation and reduced motion work');
  await context.close();

  // Controlled transport fixtures: public shape and status, not claimed as observed prices.
  const feedContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const live = await feedContext.newPage(); let failFeed = true, socketRoute;
  const now = Date.UTC(2026, 9, 14, 12, 3) / 1000, originBar = Math.floor(now / 300) * 300;
  await feedContext.route('https://api.kraken.com/0/public/**', async route => {
    if (failFeed) { await route.fulfill({ status: 503, body: 'fixture failure', contentType: 'text/plain' }); return; }
    const u = new URL(route.request().url()), path = u.pathname;
    const symbol = (u.searchParams.get('pair') || 'XBTUSD').replace('XBT', 'BTC');
    let result;
    if (path.endsWith('AssetPairs')) result = { pair: { lot_decimals: 6, ordermin: '.00001', status: 'online' } };
    else if (path.endsWith('Ticker')) result = { pair: { c: ['100'], o: '99', p: ['100', '100'], v: ['1000', '2000'] } };
    else { const minutes = Number(u.searchParams.get('interval')), end = Math.floor(now / (minutes * 60)) * minutes * 60; result = { [symbol]: Array.from({ length: 721 }, (_, i) => { const price = minutes === 5 && i === 718 ? 99 : minutes === 5 && i === 719 ? 100.5 : 100; return [end - (720 - i) * minutes * 60, String(price), String(price + 1), String(price - 1), String(price), String(price), minutes === 5 && i === 719 ? '100' : '10', 1]; }), last: end - minutes * 60 }; }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ error: [], result }) });
  });
  await feedContext.routeWebSocket('wss://ws.kraken.com/v2', ws => { socketRoute = ws; ws.onMessage(message => { const request = JSON.parse(message); if (request.method === 'subscribe') { ws.send(JSON.stringify({ method: 'subscribe', success: true })); ws.send(JSON.stringify({ channel: 'ohlc', data: [{ symbol: 'BTC/USD', interval: 5, interval_begin: new Date(originBar * 1000).toISOString(), open: 100, high: 102, low: 99, close: 101, volume: 20 }] })); } }); });
  await live.clock.install({ time: new Date(now * 1000) });
  await live.goto(preview.url); await live.getByLabel('Data source', { exact: true }).selectOption('kraken'); await expect(live.getByRole('alert')).toContainText('503');
  await expect(live.getByText('Synthetic demo · May 18, 2026')).toHaveCount(0); await expect(live.getByRole('heading', { name: 'Market data unavailable', exact: true })).toBeVisible();
  failFeed = false; await live.getByRole('button', { name: 'Retry connection', exact: true }).click(); await expect(live.locator('.current-price strong')).toHaveText('$101.00');
  await expect(live.locator('.data-banner')).toContainText('Kraken stream'); await expect(live.locator('.chart-caption')).toContainText('720 contiguous bars');
  const liveDownload = live.waitForEvent('download'); await live.getByRole('button', { name: 'Export', exact: true }).click(); const liveData = JSON.parse(await readFile(await (await liveDownload).path(), 'utf8')); assert.equal(liveData.snapshot.candles.length, 720); assert.equal(liveData.snapshot.forming.close, 101); assert.equal(liveData.snapshot.candles.at(-1).close, 100.5); assert.equal(liveData.snapshot.sources.every(s => s.status === 'unavailable'), true);
  socketRoute.send(JSON.stringify({ channel: 'ohlc', data: [{ symbol: 'BTC/USD', interval: 5, interval_begin: new Date(originBar * 1000).toISOString(), open: 100, high: 103, low: 99, close: 102, volume: 30 }] })); await expect(live.locator('.current-price strong')).toHaveText('$102.00');
  await live.getByRole('button', { name: 'Open alerts, 1 saved', exact: true }).click();
  await expect(live.locator('.alert-item')).toHaveCount(1);
  await live.getByText('Recorded conditions', { exact: true }).click(); await expect(live.getByRole('dialog')).toContainText('Relative volume');
  await live.keyboard.press('Escape');
  socketRoute.send(JSON.stringify({ channel: 'status', data: [{ system: 'maintenance' }] }));
  await expect(live.getByRole('alert')).toContainText('not reporting normal');
  await expect(live.locator('.setup-state')).toContainText('Feed paused or stale');
  socketRoute.send(JSON.stringify({ channel: 'status', data: [{ system: 'online' }] }));
  socketRoute.send(JSON.stringify({ channel: 'ohlc', data: [{ symbol: 'BTC/USD', interval: 5, interval_begin: new Date(originBar * 1000).toISOString(), open: 100, high: 103, low: 99, close: 102, volume: 30 }] }));
  await expect(live.getByRole('alert')).toHaveCount(0);
  await live.getByRole('button', { name: 'Pause feed', exact: true }).click(); await expect(live.locator('.data-banner')).toContainText('Feed paused'); await expect(live.locator('.setup-state')).toContainText('Feed paused or stale'); await expect(live.locator('.price-chart')).toBeVisible();
  await live.getByRole('button', { name: 'Resume feed', exact: true }).first().click(); await expect(live.locator('.current-price strong')).toBeVisible(); await expect(live.getByRole('button', { name: 'Open alerts, 1 saved', exact: true })).toBeVisible();
  await live.evaluate(() => { location.hash = 'portfolio'; }); await expect(live.locator('tbody tr')).toHaveCount(0);
  await live.getByLabel('Data source', { exact: true }).selectOption('demo'); await expect(live.locator('.data-banner')).toContainText('Synthetic demo');
  await feedContext.close();
  pass('Feed fixtures prove failure never falls back to demo, recovery works, live forming bars stay out of rules, updates deduplicate and pause/resume works');

  // Actual WebKit attempt; unsupported system libraries are recorded, not a pass.
  try {
    const safari = await webkit.launch({ headless: true });
    try { const page = await safari.newPage({ viewport: { width: 390, height: 844 } }); await page.goto(preview.url); await page.getByRole('button', { name: 'Review setup', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Swing', exact: true }).click(); await expect(page.locator('.setup-state')).toContainText('Trend continuation'); pass('WebKit mobile primary review and workspace switching'); }
    finally { await safari.close(); }
  } catch (error) { report.limitations.push(`WebKit unavailable: ${String(error).slice(0, 500)}`); console.log('LIMITATION WebKit unavailable; see report.'); }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.resourceErrors, []);
  pass('No JavaScript page errors or failed local production assets during application checks');
} catch (error) { report.failure = String(error.stack || error); throw error; }
finally { await writeFile('artifacts/browser-validation.json', JSON.stringify(report, null, 2)); await browser.close(); await preview.close(); }
