# Pulse: personal trading workspace

This is the SIMD-CHAT research update to [the existing Pulse app](https://github.com/identity-md-launches/launch-1280-simd-chat-build-custom-web), based on upstream commit `8220e881d0f5809b46132c04d31d72b793a2fcfc`. It retains **Vite, React, TypeScript, plain CSS, Inter and Lucide**, plus the existing optional **Python/FastAPI/CCXT/SQLite** service. The dark slate and mint design is preserved.

The finished website is **`dist/index.html` and `dist/assets/`**. The default workspace is explicitly synthetic and works offline. Selecting **Kraken live** connects public market data without an account, wallet or API key. All interface text is English.

![Pulse trading dashboard](artifacts/dashboard-desktop.jpg)

## Install, preview and rebuild

Use Node.js 22 or later and npm:

```sh
npm ci
npm run dev
```

To serve the delivered production export:

```sh
npm run preview
```

Use the URL printed by Vite. A dependency-free preview is also possible:

```sh
python3 -m http.server 4173 --directory dist
```

To rebuild from the lockfile and run checks:

```sh
npm run typecheck
npm test
npm run build
npm run check:budget
```

To reproduce browser checks:

```sh
npx playwright install chromium webkit
npm run check:browser
npm run check:live
```

The browser checks own a temporary HTTP preview and close it when finished. `check:live` makes a bounded real Kraken REST/WebSocket connection; network availability is not a deterministic test requirement. On Linux, WebKit needs its platform libraries. The supplied machine lacked those libraries, so its WebKit attempt is recorded as unperformed.

Vite has `base: './'`. All required fonts, images, styles and scripts are local; exported asset URLs are relative. Hash navigation works beneath a gateway subpath without server rewrites. Serve the **complete contents of `dist/`** over HTTP(S), not a `file:` URL. The publisher serves this export without rebuilding.

## What changed

The [research report](https://explorer.imd.fun/jobs/2f648e6d-0eea-4780-a806-89ca8755127e) recommends data correctness, volume confirmation, cost-aware risk and distinct intraday/swing workflows. The implemented mapping and deferred proposals are in [artifacts/research-mapping.md](artifacts/research-mapping.md). **The report does not establish a profitable strategy.** This app makes no return claim.

| View | Working interactions |
| --- | --- |
| Dashboard | Switch saved Intraday/Swing workspaces, choose assets and native intervals, inspect exact candles, toggle VWAP/EMA/RSI/MACD/volume, adjust indicators, review a setup and export its inputs. Higher-timeframe context follows the selected asset. |
| Paper portfolio | Open cost-aware spot-long paper positions, reserve cash, close half/all, inspect marks and exposure, edit risk limits, export/import a reconciled ledger. |
| Sentiment | Retained source weights, provenance, source filters, search and missing-source states. Public Kraken data does not fabricate sentiment. |
| Signal rules | Explain every research condition and inspect deduplicated local alerts; retain the original, separate sentiment-rule editor and exportable v1 journal. |
| Strategy lab | Evaluate a fixed research setup across chronological 60/20/20 windows, reveal the final test deliberately (including its export), compare cost-matched buy-and-hold and doubled costs, import CSV and export evidence. The original sentiment lab remains available in a disclosure. |
| Risk calculator | Long and short sizing scenarios with two-sided fees/slippage, quantity rounding, cash/notional/open-risk caps and a Wilder ATR stop on the selected interval. |
| Connections | Connect public Kraken data or the optional owner-operated service, pause/resume, retry errors, return explicitly to demo, and retain dry-run exchange templates. |
| Research / Guide | Explain formulas, source contracts, assumptions, scope and the workflow inside the app. |

The `/` key opens market search outside form fields. Dialogs support Escape and focus return. Local storage keeps workspace settings, signal rules, separate demo/live-data portfolios and up to 200 setup alerts. The app starts in demo mode on every reload; live network access is explicitly selected. A storage failure leaves the session usable and asks you to export the ledger. Research-lab results are session data; export inputs and evaluations to retain them.

## Data and calculation contract

- Kraken public REST bootstraps native 5m, 15m, 1h, 4h or 1d candles and instrument metadata. WebSocket v2 updates the selected interval; UI updates are batched to at most four per second. A 30-second snapshot refresh recovers history. A heartbeat gap over 10 seconds initiates reconnect with bounded jittered backoff. No secrets are used.
- Forming prices are shown as observations. **Only closed candles enter research indicators, setup conditions and backtests.** Duplicates are replaced by timestamp, unknown gaps reset warm-up, and aggregation requires all constituent bars. Pausing keeps the last chart for inspection and disables fresh setup eligibility.
- RSI uses Wilder smoothing and explicit flat/up/down cases. ATR uses 14 true ranges for its seed and Wilder smoothing afterward. MACD uses 12/26/9 first-value-seeded EMAs and 130-bar warm-up. EMA 20/50/200 strategy use needs 100/250/1,000 contiguous bars.
- Session or weekly VWAP uses typical-price candles and base volume; it returns unavailable without the UTC anchor or with zero volume. RVOL divides the latest closed volume by the previous 20-bar mean. It does not treat up/down candle color as taker-side flow.
- Intraday **VWAP reclaim** requires a new price/VWAP cross, RVOL above the editable threshold and RSI from 50 to 70. Swing **trend continuation** requires EMA20 > EMA50, a new MACD signal-line cross and price > EMA20. These are transparent research hypotheses.

Kraken returns recent native history, not unlimited historical backfill. EMA200 often remains unavailable on public history. Import verified longer history for research rather than treating a short aggregate as a daily trend. Demo series are deterministic synthetic examples generated at each selected interval; they are not observed historical prices or evidence of an edge.

## Paper model and limits

Each separate paper account starts with **$10,000 simulated equity**. Default limits are 0.5% risk per trade, 2% aggregate planned open risk, 2% daily loss, and 25% single-asset notional. Limits are editable and changes are journaled. The sizing formula includes adverse entry/exit slippage, fees and rounding; it caps size by cash, risk and concentration. Fee defaults are assumptions, not an exchange fee quote.

Only **unlevered spot longs** enter the maintained portfolio. Short calculations are planning scenarios and exclude funding, borrow, margin and liquidation. Only the selected market is marked/monitored. Other positions retain dated marks; stale other-asset marks block new live-data entries until refreshed. Stops/targets are evaluated from available fully closed candles beginning after entry, with stop-first collision ordering and adverse gap fills. Partial exits apportion entry fees and planned risk. A stop is not a guaranteed maximum loss.

The UTC-day loss baseline is captured at the next app observation after midnight, not from an always-on midnight collector. Browser closure, unselected markets, missing history and intrabar timing are coverage limitations. No balance is real, no exchange order is sent, and no background collector runs in a static page. Old v1 journal records remain historical notes and are not silently converted into funded positions.

## Optional service

The existing service and execution-template sources are retained. See [service/README.md](service/README.md) and [templates/README.md](templates/README.md) for setup, exact origins, server-side provider settings, schemas and dry-run operation. Paid social providers and owner-configured on-chain data remain optional. Do not put provider keys in the static website.

This update adds public browser market connectivity; it does not implement the report's always-on `/api/v2/stream` service, historical depth recorder, CVD/footprints, perpetuals or wallet cohorts. The retained Python service was not changed. Its tests could not run in this machine's default Python environment because `httpx` was absent; no backend pass is claimed.

## Validation and delivery

Actual worker results, commands, defects repaired and six-domain design coverage are in [artifacts/validation.md](artifacts/validation.md). Numerical tests: **35 passed**. Production build and independent typecheck passed. Chromium: **13 interaction groups**, **46 viewport/text-size checks**, **8 axe scans with zero violations**. The pinned design probe passed **16/16** checks. A real Kraken smoke test received REST history and an OHLC WebSocket frame. These are worker observations, not independent certification or performance guarantees.

Dependencies were installed in `/tmp/simd-build`, with a clean source mirror, to keep repository dependency/cache paths untouched. Source and lockfile here reproduce the build. Required exports and screenshots are included; no dependencies, registries, archive mirrors or submodules are submitted. [PATH_BUDGET.md](PATH_BUDGET.md) defines explicit path ceilings; [artifacts/budget.json](artifacts/budget.json) records the final inventory against the 8 MiB limit.

**Publication:** the assignment's publisher uploads the supplied `dist/` and assigns the `si-md.xyz` subdomain after submission. No hostname has been invented and no publishing command was run. The [requested GitHub repository](https://github.com/identity-md-launches/launch-1280-simd-chat-build-custom-web) is the source lineage and update target; this worker did not push a remote commit or modify `.git/`.

See [DESIGN.md](DESIGN.md) for the implemented design system and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for preserved attribution and licenses.
