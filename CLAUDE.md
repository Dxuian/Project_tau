# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules

- **Everything runs in Docker.** Never run node, npm, tsc, emcc, wrangler or tests on the host. Top level: `./dev <cmd>`; library: `cpuminer-opt-js/dev <cmd>` (see `cpuminer-opt-js/CLAUDE.md`).
- **No live mining or real-network pool connections from this machine.** Tests use mocks, a private regtest bitcoind (`docker compose` service `bitcoind`: no peers, `-connect=0`) and local workerd via Miniflare. Never `wrangler deploy` or `wrangler login`: deployment is the user's step with their own Cloudflare account.
- **Consent-first:** nothing mines until a visitor starts it. Don't add stealth features.
- Private repo, no license, not published. Dependencies are exact-pinned and installed with `--ignore-scripts`; runtime dependencies live in the library and need the AUDIT.md treatment.

## Library vs app (keep this split)

- **Library (`cpuminer-opt-js/`)**: mechanisms only. Mining, wallets and payments (`dist/wallet.js`), block proofs and the payout engine (`dist/payouts.js`), the Node and Cloudflare bridges plus the share auditor (`dist/bridge.js`). Every value is a parameter; no env vars, keys or storage of its own.
- **App (top level)**: policy and deployment. `app/config.js` (`loadConfig`: every setting from `TAU_*` env vars or Worker vars), `app/service.js` (`createPayoutService`: wires auditor + engine + chain with config, stores and `OWNER_MNEMONIC`; `handleHttp` for `POST /payout`, `GET /health`), `app/stores/file.js` (Node) and `app/stores/d1.js` (Cloudflare; `schema.sql`), `app/node.js` + `server.js` (Node target), `worker.js` + `wrangler.toml` (Cloudflare target). `btc.js` re-exports everything.
- The app imports the library's committed `dist/`. After changing library code run `cpuminer-opt-js/dev build` and commit `dist/`. The Worker must not import `dist/index.js` (it would bundle the WASM miner); `test/regtest-worker.test.js` checks the bundle.

## Payout correctness (read before changing it)

- The auditor (`createShareAuditor` in the library) is the trust anchor: it rewrites visitors' stratum logins to the owner address, binds each connection to its first authorized payout address, allowlists stratum methods, re-serializes JSON, and awaits the share store before forwarding a submit.
- The engine (`verifyPayout` in the library) rebuilds headers from raw share fields (never stored hashes) and pays only for best-chain blocks with ≥100 confirmations whose coinbase txid equals the rebuilt one and pays the owner. "Once" depends on `PayoutLedger.reserve()` atomically claiming the block **and** the payment's input coins: a lock file in `stores/file.js`, one D1 batch (primary keys `block_hash`, `outpoint`) in `stores/d1.js`. Both stores run the same contract tests in `test/stores.test.js`; keep them in sync.
- Amounts are bigint satoshis; JSON responses stringify them (`toJson`). The regtest subsidy halves every 150 blocks, so tests compare against what bitcoind reports (`ownerReward` in `test/helpers.js`).
