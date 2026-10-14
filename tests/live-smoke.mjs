import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createPreview } from '../scripts/preview.mjs';
const preview = await createPreview();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const report = { startedAt: new Date().toISOString(), source: 'Kraken public REST and WebSocket v2', requests: [], stream: { ohlcFrames: 0, heartbeatFrames: 0 }, errors: [], limitations: ['A bounded reachability and schema smoke test, not an uptime or trading-performance guarantee.'] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('response', response => { if (response.url().startsWith('https://api.kraken.com/')) report.requests.push({ url: response.url(), status: response.status() }); });
  let resolveStream;
  const streamed = new Promise(resolve => { resolveStream = resolve; });
  page.on('websocket', ws => ws.on('framereceived', event => {
    try { const message = JSON.parse(event.payload.toString()); if (message.channel === 'heartbeat') report.stream.heartbeatFrames++;
      if (message.channel === 'ohlc') { report.stream.ohlcFrames++; const row = message.data?.at(-1); report.stream.last = { symbol: row?.symbol, interval: row?.interval, intervalBegin: row?.interval_begin, close: row?.close, volume: row?.volume }; resolveStream(); }
    } catch { /* Control/non-JSON frames are not candle observations. */ }
  }));
  await page.goto(preview.url);
  await page.getByLabel('Data source', { exact: true }).selectOption('kraken');
  let timer;
  await Promise.race([streamed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('No real OHLC WebSocket frame within 20 seconds.')), 20000); })]).finally(() => clearTimeout(timer));
  await expect(page.locator('.data-banner')).toContainText('Kraken stream');
  await expect(page.locator('.current-price strong')).toBeVisible();
  report.ui = await page.evaluate(() => ({ status: document.querySelector('.data-banner')?.textContent, price: document.querySelector('.current-price')?.textContent, history: document.querySelector('.chart-caption')?.textContent, context: document.querySelector('.context-values')?.textContent, errors: [...document.querySelectorAll('[role="alert"]')].map(e => e.textContent) }));
  await page.screenshot({ path: 'artifacts/live-dashboard.jpg', fullPage: true, type: 'jpeg', quality: 75 });
  report.result = 'PASS';
} catch (error) { report.result = 'LIMITATION'; report.errors.push(String(error)); }
finally { report.finishedAt = new Date().toISOString(); await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/live-smoke.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); await browser.close(); await preview.close(); }
