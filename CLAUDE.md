# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules

- **Everything runs in Docker.** Never run node, npm, tsc, emcc, wrangler or tests on the host. Top level: `./dev <cmd>`; library: `tau-crypto/dev <cmd>` (see `tau-crypto/CLAUDE.md`).
- **No live mining or real-network pool connections from this machine.** Tests use mocks, a private regtest bitcoind (`docker compose` service `bitcoind`: no peers, `-connect=0`) and local workerd via Miniflare. Never `wrangler deploy` or `wrangler login`: deployment is the user's step with their own Cloudflare account.
- **Consent-first:** nothing mines until a visitor starts it. Don't add stealth features.
- Private repo, no license, not published. Dependencies are exact-pinned and installed with `--ignore-scripts`; runtime dependencies live in the library and need the AUDIT.md treatment.

## Library vs server code (keep this split)

- **Library (`tau-crypto/`)**: a crypto library, mechanisms only. Every value is a parameter; no env vars, keys, storage or platform code of its own. Its entries, by where they run:
  - `dist/index.js`: mining (browsers, Node);
  - `dist/wallet.js`: wallets and payments (anywhere);
  - `dist/payouts.js`: the share auditor, block proofs, the payout engine and `createPayoutService` (servers);
  - `dist/bridge.js`: `createFetchBridge`, web-standard, with the runtime's `connect` and `upgrade` passed in (servers and edge runtimes);
  - `dist/bridge/node.js`: `createBridge` (Node).
- **Server code (`server/`)**: policy and deployment, not part of the library.
  - `config.js` (`loadConfig`: every setting from `TAU_*` env vars or Worker vars; `chainFromConfig`).
  - `api.js` (`createPayoutApi`: the library's `createPayoutService` with config, stores and `OWNER_MNEMONIC`; `fetch(request)` for `POST /payout`, `GET /health`).
  - `node/` (`server.js` entry, `index.js` `startNodeServer`, `file-stores.js`).
  - `cloudflare/` (`worker.js` holds the only Cloudflare-specific code: `connect` from `cloudflare:sockets`, `WebSocketPair`, `cf-connecting-ip`; plus `d1-stores.js`, `schema.sql`, `wrangler.toml`).
- **A future Next.js or Cloudflare Pages app** puts `'use client'` / `'use server'` in its own files. Client code imports `tau-crypto` and `/wallet`; server code imports `/payouts`, `/bridge` and `server/*`. Never re-add a facade that mixes client and server exports (the old `btc.js`).
- Server code imports the library's committed `dist/`. After changing library code, run `tau-crypto/dev build` and commit `dist/`.
- The Worker must not import `dist/index.js` (it would bundle the WASM miner). `test/regtest-worker.test.js` checks the bundle; `tau-crypto/test/entries.test.ts` checks that the edge entries carry no Node built-ins, WASM or Cloudflare names.

## Payout correctness (read before changing it)

- The auditor (`createShareAuditor` in `tau-crypto/payouts`) is the trust anchor. It:
  - rewrites visitors' stratum logins to the owner address;
  - binds each connection to its first authorized payout address;
  - allowlists stratum methods and re-serializes JSON;
  - awaits the share store before forwarding a submit.
  `createPayoutService` builds it with `poolUser = ownerAddress` and refuses owner words that don't derive that address, so the login and the paying wallet can't drift apart.
- The engine (`verifyPayout`) rebuilds headers from raw share fields (never stored hashes). It pays only for best-chain blocks with ≥100 confirmations whose coinbase txid equals the rebuilt one and pays the owner.
- "Once" depends on `PayoutLedger.reserve()` atomically claiming the block **and** the payment's input coins:
  - a lock file in `server/node/file-stores.js`;
  - one D1 batch (primary keys `block_hash`, `outpoint`) in `server/cloudflare/d1-stores.js`.
  Both stores run the same contract tests in `test/stores.test.js`; keep them in sync.
- Amounts are bigint satoshis; JSON responses stringify them (`toJson`). The regtest subsidy halves every 150 blocks, so tests compare against what bitcoind reports (`ownerReward` in `test/helpers.js`).
