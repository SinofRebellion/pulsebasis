# PulseBasis

**What did your HEX really cost?** PulseBasis is a free, fully client-side cost-basis analyzer for Richard Heart ecosystem coins on PulseChain: HEX, PLS, PLSX, INC and PRVX.

Paste one or more wallet addresses (treated as one person). The site replays every transaction straight from the chain, prices each buy at the exact block it happened, and reads it back as one story:

1. **Your position**: value today, cost of what you hold, unrealized gain/loss, and per-coin average cost and break-even. HEX counts liquid, staked principal and the interest earned so far.
2. **What it cost**: each buy charted against the market price, what you paid vs the market at that block, and your best and worst buys still held.
3. **Stakes & interest**: active stakes, T-shares, interest earned so far (at $0 cost), how much it lowers your average, a maturity timeline with estimated payouts, and early-end penalties compared with interest earned.
4. **How you got in**: money in by on-ramp/bridge (share %, fees), GoPulse fees measured on-chain, gas, where your buys happened, money in/out over time, and free coins.
5. **Accuracy**: % priced at the exact block, a balance reconciliation for every coin against the chain, known gaps, the method, a CSV export of lots and a print/PDF view.

Unofficial. Not affiliated with Richard Heart, HEX, PulseChain or PulseX. Not financial or tax advice.

## Privacy

- Addresses and results never leave the browser except in requests to public blockchain APIs.
- One tiny backend: `netlify/functions/ev.mts` stores anonymous usage counts (a visit happened, referring site, phone or not; per scan: duration, retries, rate/range-limit hits, per-server request/fail/slow counts, finished or not). No addresses, IPs or balances. Skipped for Do Not Track and automated browsers.
- Owner dashboard: `/stats` (key in `PB_STATS_KEY`, read by `netlify/functions/stats.mts`). Traffic-light thresholds live in `src/stats/summarize.ts`.
- A strict Content-Security-Policy (`index.html`) only allows connections to `rpc.pulsechain.com`, `rpc-pulsechain.g4mm4.io`, `api.scan.pulsechain.com` and `graph.pulsechain.com`. No third-party analytics, fonts or CDNs.
- Downloaded history and block prices are cached in the browser's IndexedDB, so re-runs take seconds. "Clear local cache" wipes it.

## Run / build

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # outputs dist/, a static site you can host anywhere (Netlify, Vercel, GitHub Pages, IPFS, S3)
npx vite preview   # serve dist/ locally
```

`dist/` is self-contained. Upload the folder as-is. It uses relative asset paths (`base: "./"`), so it works at a domain root, in a sub-folder or on IPFS.

## How it works

All heavy work runs in a Web Worker (`src/worker.ts` → `src/engine/run.ts`):

| Step | File | What |
|---|---|---|
| Collect | `engine/fetch.ts` | Explorer `txlist` / `txlistinternal`, all ERC-20 `Transfer` logs to/from each wallet, HEX `StakeStart`/`StakeEnd` logs (archive RPC `eth_getLogs`), token metadata, block times, HEX daily payout data, current stakes and balances (Multicall3). Gaps in the explorer's internal-tx index are filled with `trace_transaction`. If the PLS balance doesn't reconcile, every PLS-carrying transaction's status is re-checked against node receipts (the explorer sometimes marks reverted transactions as successful). |
| Price | `engine/fetch.ts`, `engine/replay.ts` | PulseX v1/v2 `getReserves` at *block − 1* for every block you traded in (batched through Multicall3), routed WPLS→USD through the deepest stablecoin pools. Liquidity floor plus an outlier check against the PulseX subgraph's daily price, with daily price as the fallback. Today's prices come from live reserves. |
| Replay | `engine/replay.ts` | Average-cost pools per coin. Swaps carry cost from what you gave to what you got. Stake interest, farm rewards, bonuses and fork copies count at $0. Junk tokens and LP tokens are ignored. Moves between your own wallets are internal. |
| Classify | `engine/registry.json` | On-ramp and venue registry: OmniBridge, Hyperlane, LibertySwap, Coast/Coast0x, ProveX, SwapToPulse/ChangeNOW-type custodial senders, CEX hot wallets, PulseX routers, GoPulse, Piteas, 9inch, Zerion and others, with published fees, sources and verification status. Unknown senders are still counted at market value. |
| Analyze | `engine/analyze.ts` | The report object behind every section of the UI. |

Accuracy labels: **exact** (stablecoin amounts, or exact-block pool prices), **high** (bridge arrivals valued at the arrival block), **estimate** (custodial/CEX payouts whose off-chain markup can't be seen).

## Tests

- `test/fromPython.ts`: parity test. Runs the TypeScript engine on the Python reference implementation's cached raw data and compares the results.
- `test/live.ts`: runs the same engine in Node against live endpoints: `npx tsx test/live.ts 0xA,0xB`.
- `test/e2e.mjs`: Playwright run of the production build (desktop and iPhone, the reference wallets checked against the Python ground truth, a random active HEX staker, an empty address, first-run and cached-rerun timing, CSV and PDF). `npx vite preview --port 4173 & node test/e2e.mjs`.

## Adding an on-ramp

Add an entry to `ramps` in `src/engine/registry.json` with `match` (sender addresses, contract `to`, or a heuristic), `fee` (`pctIn`, `pctOut`, text), `accuracy`, `verified` (`true` / `"observed"` / `"heuristic"`) and `sources`. No code changes are needed.


## Origin & credit

PulseBasis was conceived and created by **[@sinofrebellion](https://x.com/sinofrebellion)** and launched on **October 10, 2026** at https://pulsebasis.netlify.app.

Licensed under the Apache License 2.0 (`LICENSE`). Redistributions and derivative works must keep the `NOTICE` file crediting @sinofrebellion as the original creator. Proof of authorship (SHA-256 hashes anchored in Bitcoin with OpenTimestamps) is in `AUTHORSHIP.md`.

## Binary files in this repository

Logos, the share image and the OpenTimestamps proof are stored as base64 text under `binary/` (with SHA-256 checksums in `binary/manifest.json`). `npm run dev` / `npm run build` restore them automatically; run `npm run restore` to do it by hand (for example before `ots verify proof/STATEMENT.txt.ots`).
