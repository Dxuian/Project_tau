# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout (keep it: two folders)

The top level holds only these; don't add top-level folders or files:
- `tau-crypto/` (the library);
- `server/` (everything deployed, with its tests and tooling);
- `.github/` (the Alerts workflow and its script; the owner approved it);
- `README.md`, `CLAUDE.md`, `docker-compose.yml` (server/'s containers) and `.gitignore`.

There is no upstream clone. `tau-crypto/dev vendor` fetches the pinned cpuminer-opt into the library's cache volume.

## Alerts (`.github/`)

`.github/workflows/alerts.yml` runs `.github/scripts/alerts.sh` every 15 minutes on GitHub's runners (not this machine).
- **What it checks:** the payout Worker's `/health` (`ok`, `canPay`), the site's home page and `/api/address`. With the `POSTHOG_READ_KEY` secret (a read-only PostHog personal key), it also counts, in the last 20 minutes, `blocks_seen`, `$exception` and `mining_unavailable`, and `mining_error` over 10.
- **How it alerts:** each failing check keeps one open issue labelled `alert`, keyed by an `<!-- alert:id -->` marker. The issue mentions the repo owner, because scheduled-run emails go to whoever pushed the cron line (`unnat-bharol`, not the owner `Dxuian`). It closes with a comment once the check passes. The run fails only when it can't manage the issues.
- **Public:** the repo is public, so its issues and Actions logs are too. Write causes and counts only, never event contents.
- **Trying it:** `DRY_RUN=1` prints the issue operations instead of running them. A manual run with `test` ticked opens a test alert, which the next run closes. Lint with actionlint and shellcheck (in Docker).

## Rules

- **Everything runs in Docker.** Never run node, npm, tsc, emcc, wrangler, next or tests on the host. Library: `tau-crypto/dev <cmd>` (see `tau-crypto/CLAUDE.md`). Server: `server/dev <cmd>` (it uses the top-level `docker-compose.yml`, working directory `server/`).
- **No live mining or real-network pool connections from this machine.** Tests use mocks, a private regtest bitcoind (`docker compose` service `bitcoind`: no peers, `-connect=0`), a local TiDB (service `tidb`, in memory) and local workerd via Miniflare / `wrangler dev`. Never `wrangler deploy`, `wrangler login`, `opennextjs-cloudflare deploy`, `vercel`, `server/dev db migrate` / `npm run db:migrate` or anything else that touches the user's TiDB Cloud: deployment is the user's step with their own accounts. The connection string (`DB_PASSWORD`) never goes into a file. wrangler and Next.js telemetry are off in the containers (`WRANGLER_SEND_METRICS`, `NEXT_TELEMETRY_DISABLED`).
- **Consent-first:** nothing mines until a visitor starts it. Don't add stealth features.
- The GitHub repo is public (nothing secret goes in it), with no license, and is not published to npm. Dependencies are exact-pinned and installed with `--ignore-scripts`. The library's runtime dependencies need the AUDIT.md treatment. These get `npm audit signatures`:
  - the site's framework dependencies (next, react, OpenNext);
  - its analytics, posthog-js: a release at least a week old, with provenance;
  - the server's database packages (drizzle-orm, drizzle-kit, @tidbcloud/serverless).

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
    - `tidb/`: TiDB Cloud (MySQL) for either target, the production store:
      - `tidb-stores.js`;
      - `client.js`: `tidbDatabase`, Drizzle over the HTTPS driver;
      - `schema.js`, `migrations/`;
      - `migrate.js`, which is `npm run db:migrate`;
    - `cloudflare/`:
      - `worker.js` holds the only Cloudflare-specific code: `connect` from `cloudflare:sockets`, `WebSocketPair`, `cf-connecting-ip`;
      - `d1-stores.js` with its own `schema.js` and `migrations/`;
      - `wrangler.toml`, with an hourly cron for payouts and the share purge.
  - `site/`: the website, Next.js 16 App Router, plain JS.
    - Client components (`'use client'`) import `tau-crypto/wallet`.
    - The library is copied in, not linked: `scripts/copy-library.mjs` copies `tau-crypto/dist` (on every build) to `lib/tau-crypto/` (imported as `tau-crypto/*` through `jsconfig.json`) and `public/tau-crypto/` (the miner, which the mine page loads at run time, so it is never bundled). The app needs nothing outside its folder, which OpenNext requires.
    - Server code reads `PAYOUT_API_URL`, `BRIDGE_URL`, `POOL_URL`, `NETWORK`, `POSTHOG_KEY` and `POSTHOG_HOST` at request time (the root layout is `force-dynamic` for this). `wrangler.jsonc` and `open-next.config.ts` are the Cloudflare (OpenNext) target; Vercel needs nothing extra.
    - `wrangler.jsonc` has `global_fetch_strictly_public`: both Workers are on the same workers.dev subdomain, and without it the site's calls to the payout Worker fail (error 1042).
  - `test/`: server and site tests. `docker/bitcoind/`: the regtest node image.
- Never re-add a facade that mixes client and server exports (the old `btc.js`): it breaks `'use client'` / `'use server'`.
- Server code imports the library's committed `dist/`. After changing library code, run `tau-crypto/dev build` and commit `dist/`.
- The payout Worker must not import `dist/index.js` (it would bundle the WASM miner). `server/test/regtest-worker.test.js` checks the bundle; `tau-crypto/test/entries.test.ts` checks that the edge entries carry no Node built-ins, WASM or Cloudflare names.

## Analytics (PostHog, site only)

The wallet page shows the visitor's 12 words, and the site promises they never leave the device. So `site/lib/analytics.js` sends only what the site chooses:
- **Never re-enable page-reading features:** autocapture, session replay, heatmaps, surveys, exception autocapture (it loads a script), remote config (`advanced_disable_flags`), or external scripts (`disable_external_dependency_loading`).
- **Events are explicit:** `track(name, props)` calls, page views and uncaught errors (`posthog.captureException` on the window's error events).
- **Props never carry words or addresses.** `before_send` (`prepareEvent`) also replaces every Bitcoin address with `[address]` and adds `app: "project-tau"` to every event. The PostHog project is shared with the owner's other apps; `app` tells them apart.
- **Keys:** only the public `phc_` project key goes in config (`POSTHOG_KEY`). The personal API key (`phx_`) never goes in the site, its settings or the repository.
- **Tests:**
  - `server/test/site.test.js` runs the whole flow against a stand-in PostHog (`startFakePostHog`). It fails if any request contains the words, two adjacent words or an address, or if PostHog's config or scripts are fetched.
  - Playwright pages must open in `desktopContext(browser)`, from a browser launched with `DESKTOP_ARGS`. Otherwise posthog-js treats the browser as a bot (`navigator.webdriver`, or a HeadlessChrome user agent or brand) and sends nothing.
  - The Cloudflare site test overrides `POSTHOG_KEY` / `POSTHOG_HOST`, so tests never send to the real PostHog.
- **Source maps:** `productionBrowserSourceMaps` serves them publicly (the source is public), so PostHog's error tracking needs no upload step or CLI.

## Database (Drizzle)

- **Tables** are defined only in `server/tidb/schema.js` (MySQL) and `server/cloudflare/schema.js` (SQLite, for D1). Keep the two equivalent.
- **Migrations** are generated, never written by hand:
  - after editing a schema, run `server/dev db generate <name>` and commit the SQL and the `meta/` it writes;
  - never edit a migration that may have been applied;
  - `server/test/migrations.test.js` fails if a schema and its migrations disagree.
- **The stores only read and write rows.** They never create tables.
  - The Worker can't read files, so migrations are applied outside it: `npm run db:migrate` for TiDB, which also creates the `tau` database because the connection string names `sys`; `wrangler d1 migrations apply` for D1.
  - The tests apply the same files with Drizzle's migrators (`tidbTestDatabase`, `migrateD1` in `server/test/helpers.js`).
  - `tidb/migrate.js` uses `node:fs`: never import it from `worker.js` or anything it imports.
- **Driver differences:**
  - affected rows: TiDB Cloud's HTTPS driver returns `{ rowsAffected }`, while mysql2 (local TiDB in the tests) returns `[{ affectedRows }]`;
  - Drizzle wraps driver errors, so the original is `err.cause`;
  - D1 has no interactive transactions (use `db.batch`), no `DELETE … LIMIT`, and a cap on parameters per statement.

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
  - one transaction in `server/tidb/tidb-stores.js` and one D1 batch in `server/cloudflare/d1-stores.js`, both relying on the primary keys `block_hash` and `outpoint`.

  All three stores (and their `purge`, which never touches block shares or payouts) run the same contract tests in `server/test/stores.test.js`; keep them in sync.
- **Amounts** are bigint satoshis; JSON responses stringify them (`toJson`).
  - The regtest subsidy halves every 150 blocks, so tests compare against what bitcoind reports (`ownerReward` in `server/test/helpers.js`).
  - The end-to-end tests use 2 s slots (`FAST_SLOTS`).
