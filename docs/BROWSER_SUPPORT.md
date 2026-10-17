# Browser support

The deck is a desktop application in the browser, built and judged at 1440 × 1000. It runs on:

| Browser | Versions | Notes |
|---|---|---|
| Chrome, Edge | the last two major versions | WebGPU where the browser offers it, WebGL 2 otherwise |
| Firefox | the last two major versions (113 at the oldest) | WebGL 2 |
| Safari | the last two major versions (16.4 at the oldest) | WebGL 2; WebGPU from Safari 26 |

Hardware acceleration must be on: the 3D views and the globe need a WebGL 2 context. A browser
with acceleration off, or a remote desktop without a GPU, draws the 2D tools and says why the 3D
ones cannot be drawn.

Phones and tablets are not targets.

## What the gate checks

`deck/gate.js` runs before the deck's code, in every browser, and says in words when the browser
cannot run the deck instead of leaving the page blank. It checks for WebGL 2, `CompressionStream`
(share links), `structuredClone`, `BroadcastChannel` (sign-out across tabs), `Array.prototype.at`,
Web Crypto (sign-in with PKCE needs a secure context: https or localhost) and `ResizeObserver`, and
it catches a module that the engine could not parse.

## Features the deck is built on

ES2022 modules with top-level `await`, Web Workers, `fetch` with streams, IndexedDB, WebGL 2,
`CompressionStream`, Web Crypto, `BroadcastChannel`, CSS `color-mix()`, container queries and
`:has()`. None is polyfilled.

## Checking

- `node tools/e2e/a11y.mjs <base>` (t1): axe-core over the pages and the deck's main states; zero
  serious or critical findings against WCAG 2.2 AA.
- A cross-browser smoke test on Chromium, Firefox and WebKit is planned for t1 once the browsers
  are installed on the runner (`pnpm exec playwright install firefox webkit`).
