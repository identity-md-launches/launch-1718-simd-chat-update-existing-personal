# Third-party notices

## Pulse source lineage

This update extends [the existing Pulse application](https://github.com/identity-md-launches/launch-1280-simd-chat-build-custom-web) at commit `8220e881d0f5809b46132c04d31d72b793a2fcfc`. The original interface primitives, service, execution templates and their notices are preserved. Version 2 adds the research indicators, public browser feed, paper portfolio and evaluation workflow described in `artifacts/research-mapping.md`.

## Jev-X Sentiment Analysis

[Jev-X Sentiment Analysis](https://github.com/brainstormity/Jev-X-Sentiment-Analysis), copyright (c) 2026 brainstormity, MIT. See [licenses/jev-x-MIT.txt](licenses/jev-x-MIT.txt).

Pulse retains the Python/FastAPI/CCXT/SQLite/optional TypeSafe service foundation and the symbol → market/social analysis → decision-review workflow. `service/stats.py` adapts the original fear/greed keyword sets and stratified sampling approach. Ingestion adapts the original database deduplication and pagination early stop. The preceding Pulse assignment implemented its interface, multi-source integration, risk engine, backtester and service endpoints; this update extends that work. The original Jinja/plain-JavaScript client and generated-confidence fallback are not copied.

## Better Interface and Impeccable design guidance

Design guidance is adapted from Jakub Krehel's **Better Interface**, MIT, pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`: https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface.

The documentation method is adapted from Paul Bakaus's **Impeccable**, Apache-2.0, pinned commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`: https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md.

The assignment supplied these references as a combined pinned guide. Their distinct license texts are retained verbatim in [licenses/better-interface-and-impeccable.txt](licenses/better-interface-and-impeccable.txt). No relicensing of either upstream work is intended. The review is recorded in `artifacts/validation.md`.

## Runtime assets and libraries

- Inter variable font by the Inter Project Authors: SIL Open Font License 1.1, [licenses/inter-OFL.txt](licenses/inter-OFL.txt). The locally bundled Latin WOFF2 comes from `@fontsource-variable/inter`.
- Lucide icon components: ISC, with retained Feather-derived MIT notice, [licenses/lucide-ISC.txt](licenses/lucide-ISC.txt).
- React and React DOM: MIT, [licenses/react-MIT.txt](licenses/react-MIT.txt).
- FastAPI, CCXT, HTTPX, TypeSafe SDK, Vite, TypeScript, and the other source dependencies retain their upstream licenses. Exact dependency versions are in `package-lock.json` and `service/requirements.lock.txt`; no dependency source archives are vendored.

Crypto marks, the Pulse mark, favicon, charts, and share-card composition are inline/code-authored SVG or HTML assets. The share image is rendered from `scripts/generate-social.mjs`. No third-party photographs, fabricated publisher screenshots, or externally hosted runtime images are used. Demo headlines and posts are synthetic and marked as demo content.
