# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout (keep it: two folders)

The top level holds only `tau-crypto/` (the library), `server/` (everything deployed, with its tests and tooling), `README.md`, `CLAUDE.md`, `docker-compose.yml` (server/'s containers) and `.gitignore`. Don't add top-level folders or files; there is no upstream clone. `tau-crypto/dev vendor` fetches the pinned cpuminer-opt into the library's cache volume.

## Rules

- **Everything runs in Docker.** Never run node, npm, tsc, emcc, wrangler, next or tests on the host. Library: `tau-crypto/dev <cmd>` (see `tau-crypto/CLAUDE.md`). Server: `server/dev <cmd>` (it uses the top-level `docker-compose.yml`, working directory `server/`).
- **No live mining or real-network pool connections from this machine.** Tests use mocks, a private regtest bitcoind (`docker compose` service `bitcoind`: no peers, `-connect=0`) and local workerd via Miniflare / `wrangler dev`. Never `wrangler deploy`, `wrangler login`, `opennextjs-cloudflare deploy` or `vercel`: deployment is the user's step with their own accounts. wrangler and Next.js telemetry are off in the containers (`WRANGLER_SEND_METRICS`, `NEXT_TELEMETRY_DISABLED`).
- **Consent-first:** nothing mines until a visitor starts it. Don't add stealth features.
- Private repo, no license, not published. Dependencies are exact-pinned and installed with `--ignore-scripts`. The library's runtime dependencies need the AUDIT.md treatment; the site's framework dependencies (next, react, OpenNext) get `npm audit signatures`.

## Library vs server (keep this split)

- **Library (`tau-crypto/`)**: a crypto library, mechanisms only. Every value is a parameter; no env vars, keys, storage or platform code of its own. Entries, by where they run:
  - `dist/index.js`: mining (browsers, Node);
  - `dist/wallet.js`: wallets, watch-only xpub addresses, payments (anywhere);
  - `dist/payouts.js`: the share auditor, block proofs, the payout engine, `createPayoutService` and address slots (servers);
  - `dist/bridge.js`: `createFetchBridge`, web-standard, with the runtime's `connect` and `upgrade` passed in (servers and edge runtimes);
  - `dist/bridge/node.js`: `createBridge` (Node).
- **Server (`server/`)**: policy and deployment, not part of the library.
  - The payout service:
    - `config.js` (`loadConfig`: every setting from `TAU_*` env vars or Worker vars; `chainFromConfig`, `addressPeriod`);
    - `api.js` (`createPayoutApi`: the library's `createPayoutService` with config, stores and `OWNER_MNEMONIC`; a web-standard `fetch(request)` for `GET /address`, `POST /payout`, `GET /health`);
    - `node/` (`server.js` entry, `index.js` `startNodeServer`, `file-stores.js`);
    - `cloudflare/` (`worker.js` holds the only Cloudflare-specific code: `connect` from `cloudflare:sockets`, `WebSocketPair`, `cf-connecting-ip`; plus `d1-stores.js`, `schema.sql`, `wrangler.toml`).
  - `site/`: the website, Next.js 16 App Router, plain JS.
    - Client components (`'use client'`) import `tau-crypto/wallet`.
    - The library is copied in, not linked: `scripts/copy-library.mjs` copies `tau-crypto/dist` (on every build) to `lib/tau-crypto/` (imported as `tau-crypto/*` through `jsconfig.json`) and `public/tau-crypto/` (the miner, which the mine page loads at run time, so it is never bundled). The app needs nothing outside its folder, which OpenNext requires.
    - Server code reads `PAYOUT_API_URL`, `BRIDGE_URL`, `POOL_URL` and `NETWORK` at request time. `wrangler.jsonc` and `open-next.config.ts` are the Cloudflare (OpenNext) target; Vercel needs nothing extra.
  - `test/`: server and site tests. `docker/bitcoind/`: the regtest node image.
- Never re-add a facade that mixes client and server exports (the old `btc.js`): it breaks `'use client'` / `'use server'`.
- Server code imports the library's committed `dist/`. After changing library code, run `tau-crypto/dev build` and commit `dist/`.
- The payout Worker must not import `dist/index.js` (it would bundle the WASM miner). `server/test/regtest-worker.test.js` checks the bundle; `tau-crypto/test/entries.test.ts` checks that the edge entries carry no Node built-ins, WASM or Cloudflare names.

## Payout correctness (read before changing it)

- **The auditor** (`createShareAuditor` in `tau-crypto/payouts`) is the trust anchor. It:
  - rewrites visitors' stratum logins to an owner address;
  - binds each connection to its first authorized payout address;
  - allowlists stratum methods and re-serializes JSON;
  - awaits the share store before forwarding a submit.
- **Hourly addresses.** With `addressPeriod` (server default: 1 hour, `TAU_ADDRESS_PERIOD_MS`), each connection's login is that slot's owner address: slot N = receive index N, `1 + periods since TAU_ADDRESS_EPOCH`.
  - Records carry `poolUser` and `ownerIndex`.
  - A client's `?slot=` is honored only for the current or the previous slot.
  - `createPayoutService` refuses words or an xpub that don't derive `ownerAddress` (index 0).
- **The engine** (`verifyPayout`) rebuilds headers from raw share fields (never stored hashes).
  - It pays only for best-chain blocks with ≥100 confirmations whose coinbase txid equals the rebuilt one and pays the owner address of the record's index. That address is derived from the words, never read from the record.
  - It spends from that address and sends change to index 0.
- **"Once"** depends on `PayoutLedger.reserve()` atomically claiming the block **and** the payment's input coins:
  - a lock file in `server/node/file-stores.js`;
  - one D1 batch (primary keys `block_hash`, `outpoint`) in `server/cloudflare/d1-stores.js`.

  Both stores run the same contract tests in `server/test/stores.test.js`; keep them in sync.
- **Amounts** are bigint satoshis; JSON responses stringify them (`toJson`).
  - The regtest subsidy halves every 150 blocks, so tests compare against what bitcoind reports (`ownerReward` in `server/test/helpers.js`).
  - The end-to-end tests use 2 s slots (`FAST_SLOTS`).
