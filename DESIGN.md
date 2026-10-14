# Pulse design system

## Overview

Pulse is a personal intraday and swing research workspace. This update preserves the original dark slate surfaces, mint actions, local Inter typography, Lucide outlines and compact financial data presentation. A persistent desktop navigation rail separates market context, rules, risk, simulation and connections. There is no marketing hero, light theme, wallet flow or live-order interface.

The source of truth is `src/styles.css`; shared primitives are in `src/components.tsx`, and the application shell is in `src/App.tsx`. `src/Dashboard.tsx` implements the chart/checklist composition, while form pages use the existing `.two-column`, `.stack` and `.form-stack` patterns. A dashboard arrangement is not a rule for every page.

## Colors

The canonical notation remains hex sRGB. Reuse the existing semantic custom properties in `src/styles.css:8`.

| Token | Value | Implemented role |
| --- | --- | --- |
| `--bg` / `--sidebar` | `#0c1017` / `#10151d` | Page and navigation/context surfaces |
| `--surface` / `--surface-raised` / `--surface-hover` | `#131922` / `#1d2632` / `#242f3d` | Panels, secondary layers and interactive hover |
| `--text` / `--muted` | `#ecf0f5` / `#9da9b9` | Main and secondary text |
| `--border` / `--control-border` | `#293341` / `#657184` | Structural separators and visible input outlines |
| `--accent` / `--accent-hover` | `#72e3bf` / `#94eed1` | Primary action and its hover |
| `--accent-soft` / `--on-accent` | `#1a342e` / `#102820` | Active navigation surface / text on mint |
| `--positive` / `--positive-soft` | `#72e3bf` / `#18382f` | Positive price or condition state |
| `--negative` / `--negative-soft` | `#ee8898` / `#3a222e` | Declining prices and recoverable errors |
| `--warning` / `--warning-soft` | `#ebc380` / `#342d23` | Demo provenance, pending coverage and EMA20 line |
| `--focus` | `#9dcaff` | Keyboard perimeter and EMA50 line |
| `--chart-line` | `#bca3f1` | VWAP, RSI and MACD line |
| `--chart-grid` / `--indicator-band` | `#2b3543` / `#222335` | Plot grid / RSI reference band |
| `--volume-up` / `--volume-down` | `#25473f` / `#4a2d3b` | Subdued candle-volume bars |

The original mint convention serves both actions and positive market values. Buttons have shape and action text; data values retain labels, signs or condition icons. Color alone does not identify a state. Asset marks and sentiment source colors remain decorative/category accents, with names alongside them.

Actual rendered pairs measured in Chromium: primary text on the panel **15.42:1**, secondary text on the panel **7.40:1**, primary action text on mint **9.99:1**. These identified opaque pairs are recorded in `artifacts/browser-validation.json`; they do not imply every SVG pixel or alpha-composited state was measured.

## Typography

`@font-face` loads the local Inter variable Latin WOFF2 from `@fontsource-variable/inter`. The family is `'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`. The font supplies normal weights 100–900; rendered UI uses **400, 500 and 600**. Its loaded state was checked with `document.fonts.check`.

| Token | Default size | Role |
| --- | --- | --- |
| `--text-xs` | 12px | Captions, dense desktop controls, chart labels and metadata |
| `--text-sm` | 14px | Body, labels, navigation and mobile buttons |
| `--text-base` | 16px | Section titles, mobile inputs and reading prose |
| `--text-lg` | 20px | Secondary prices, summaries and mobile metrics |
| `--text-title` | 28px | Page titles and desktop metric values |
| `--text-display` | 40px | Retained sentiment/analysis display styles |

Body line-height is 1.5, section headings 1.4 and page headings 1.2. Page titles track at −0.8px; metrics use −0.6px. Prose has comfortable unitless line-height and a 75–80ch maximum measure. Heading text balances; prose wraps naturally. Prices, timestamps and table values use tabular numerals. Mobile input text is at least 16px at the default root size.

Charts render code-authored SVG with container-aware viewboxes and 12px axis text. Four time/date ticks have anchored edges; long intervals use calendar dates. Exact open/high/low/close values remain visible outside the chart at phone widths. Buttons wrap under enlarged text instead of imposing a minimum text width.

## Layout

Desktop uses the existing 220px fixed rail (200px below 1280px; 184px below 1100px). Main content begins after the rail, uses 32px gutters, and has a maximum width of 1800px. Gutters reduce to 24px, then 20px, then 16px on phones and 12px at 370px and below. The header is 72px at desktop, approximately 60px on phones, and can wrap with enlarged text.

Groups use 20–24px separation, with 8–16px inside control groups. Main panels have 16–20px padding. The dashboard has four metric columns and a `2.25fr / minmax(290px, 1fr)` chart/checklist grid, narrowing to `1.8fr / minmax(265px, 1fr)` below 1250px. The constrained 901–1050px rail layout collapses the research grid to a column. At 900px the rail disappears and a native navigation dialog is available from the header.

At 700px and below, dashboard panels form a single column. The **chart moves before the metric grid**, putting actual market data and the primary review action on the first phone screen. Metrics remain a two-column comparison, followed by setup conditions, higher-timeframe context, price/volume levels and alerts. Static metric content precedes the chart in the DOM; this visual reorder does not change the interactive keyboard sequence. Forms and research documentation collapse to one column. Workspace/source controls wrap and keep labels accessible.

Tables scroll within labeled keyboard-focusable regions; the document itself does not horizontally scroll at the checked 320, 390, 768, 1024 and 1440px widths. The risk page also passed CSS text enlargement to a 32px root at 390px. Native browser zoom and physical devices were not tested.

## Elevation & Depth

Panels are flat: tonal surfaces and 1px structural borders, without shadows. Native dialogs are the elevation exception: borderless surface, 12px radius, layered shadow (`0 15px 50px #0006, 0 2px 8px #0004`) and a dark `#05080dc9` backdrop with 4px blur. The sidebar uses z-index 30; the skip link uses 100. No decorative glow, gradient text or loading entrance animation is introduced.

## Shapes

The shared panel radius is `--radius: 10px`. Controls use 6px, navigation 7px, badges 4px and selected workspace segments 4px inside a 7px container. Asset marks and profile marks are circles. Structural clipping is reserved for decorative bars and the table scroll region. Critical values and actions are not ellipsized.

## Components

| Component / pattern | Source | Behavior and states |
| --- | --- | --- |
| `Panel`, `Metric`, `Badge` | `src/components.tsx` | Named content groups, labeled numeric summaries, neutral/positive/negative/warning/accent variants. Labels accompany status colors. |
| Buttons / fields | `src/styles.css` | Mint primary action, outlined secondary action, icon utilities, hover/pressed/focus/disabled states; native labeled inputs and selects. Errors are adjacent and announce through alerts. |
| `Modal` | `src/components.tsx` | Native `<dialog>`, labeled title, Escape and backdrop dismissal, native focus containment and trigger restoration. Navigation, setup review, settings and import confirmation reuse it. |
| `Chart`, `Sparkline` | `src/Chart.tsx` | Controlled native interval, saved overlays, optional RSI/MACD panes, 32/64/120-bar view, height/reset controls and keyboard candle inspection. Null coverage produces an explanation, not a numeric stand-in. |
| `SignalChecklist` | `src/Dashboard.tsx` | Every condition exposes label, status and actual input or missing dependency. Three-segment progress is redundant decoration. |
| `PaperTicket` | `src/PaperTicket.tsx` | Stop/target/cost inputs, cash/risk estimate, explicit simulation confirmation, recoverable validation and saved-position success state. Missing ATR leaves prices for manual entry. |
| Portfolio rows / ledger | `src/pages/Portfolio.tsx` | Dated marks, monitored/unmonitored status, partial/full exits, risk settings and confirmation before replacing imported state. |
| Research evaluation | `src/pages/ResearchLab.tsx` | Pending run, validation errors, empty results, chronological sections and deliberately revealed final test; exports omit the final test until reveal and retain a viewed warning across reruns. |
| Workspace/source controls | `src/App.tsx` | Independently persisted Intraday/Swing settings, explicit demo/live/service selection, real loading/error/retry states, pause retaining last data. |

The global focus style is a 2px `--focus` outline with 4px offset; forced-colors uses `Highlight`. H1 focus on hash navigation is a reading destination. Native keyboard operation and focus return were exercised; no screen-reader session is claimed. Lucide is the sole UI icon library.

Motion is opt-in under `prefers-reduced-motion: no-preference`: 120ms named background/color/scale transitions, 0.96 button press and a refresh spinner. Reduced motion disables the spinner and movement. No `transition: all` or uncontrolled animation exists.

## Do's and Don'ts

- Start a new tool page with `Panel`, `.stack` or `.two-column`; use the existing semantic tokens and six-size type scale.
- Put the working tool and its primary verb action before explanatory material. Keep dense metrics labeled and numeric columns stable.
- Show data provenance, interval, timestamp and missing coverage. Never replace a failed live feed with synthetic values implicitly.
- Use one visually primary action for a task, native form controls and explicit dialog consequences. Keep critical controls usable with large text.
- Reuse the flat slate/mint system and one icon family; do not add unrelated card effects, fonts, gradients or small tracked uppercase headings.
- Add the hash route and navigation entry in `App.tsx`, reuse its heading/focus behavior, then check 390px first-screen access, 320px reflow, desktop, keyboard flow and error recovery. Rebuild `dist/` after source changes.

Design guidance attribution and licenses are retained in `THIRD_PARTY_NOTICES.md` and `licenses/`. Review evidence and unperformed checks are in `artifacts/validation.md`.
