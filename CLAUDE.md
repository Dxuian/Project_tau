# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout (keep it: two folders)

The top level holds only these; don't add top-level folders or files:
- `tau-crypto/` (the library);
- `server/` (everything deployed, with its tests and tooling);
- `README.md`, `CLAUDE.md`, `docker-compose.yml` (server/'s containers) and `.gitignore`.

There is no upstream clone. `tau-crypto/dev vendor` fetches the pinned cpuminer-opt into the library's cache volume. There is no `.github/`: the alerts live in PostHog (GitHub's scheduled runs were hours apart).

## Alerts (PostHog)

Five alerts in Project Tau's PostHog project (702597, US Cloud), each named for its cause. They are checked hourly and emailed to the owner. They and the "Project Tau" dashboard were made through PostHog's API with the owner's personal key, which never goes in the repo.
- **What visitors' pages report** (the current hour): `blocks_seen` over 0, `$exception` over 0, `mining_unavailable` over 0, `mining_error` over 10.
- **The payout service:**
  - Every cron run (every 15 minutes) sends a `payout_health` event (`server/health.js`, from `scheduled` in `cloudflare/worker.js`). It carries `can_pay`, `sweep_ok`, `purge_ok`, `site_ok` (the site's `/api/address`, which also proves the site reaches this service) and `ok`.
  - Its alert, "payout service unhealthy or silent", looks at the last complete hour: A (events with `ok` true) − 10 × B (events with `ok` false) below 1. So it fires on silence (a broken deploy, settings or cron sends nothing) and on any bad event.
- **The event:** booleans and public settings only, never a secret, an address or anything about a visitor.
  - Settings: `TAU_POSTHOG_KEY` (a `phc_` project key; `healthTarget` refuses anything else), `TAU_POSTHOG_HOST` and `TAU_SITE_URL`.
  - A missing or unusable value stops the event (and so fires the alert), never the service.

## Rules

- **Everything runs in Docker.** Never run node, npm, tsc, emcc, wrangler, next or tests on the host. Library: `tau-crypto/dev <cmd>` (see `tau-crypto/CLAUDE.md`). Server: `server/dev <cmd>` (it uses the top-level `docker-compose.yml`, working directory `server/`).
- **No live mining or real-network pool connections from this machine.** Tests use mocks, a private regtest bitcoind (`docker compose` service `bitcoind`: no peers, `-connect=0`), a local TiDB (service `tidb`, in memory) and local workerd via Miniflare / `wrangler dev`. Never `wrangler deploy`, `wrangler login`, `opennextjs-cloudflare deploy`, `vercel`, `server/dev db migrate` / `npm run db:migrate` or anything else that touches the user's TiDB Cloud: deployment is the user's step with their own accounts. The connection string (`DB_PASSWORD`) never goes into a file. wrangler and Next.js telemetry are off in the containers (`WRANGLER_SEND_METRICS`, `NEXT_TELEMETRY_DISABLED`).
- **Consent-first:** nothing mines until a visitor starts it. Don't add stealth features.
- The GitHub repo is public (nothing secret goes in it), with no license, and is not published to npm. Dependencies are exact-pinned and installed with `--ignore-scripts`. The library's runtime dependencies need the AUDIT.md treatment. These get `npm audit signatures`:
  - the site's framework dependencies (next, react, OpenNext);
  - its analytics, posthog-js: a release at least a week old, with provenance;
  - its UI: Tailwind CSS v4 (`tailwindcss`, `@tailwindcss/postcss`, `postcss`; build time only), the Radix primitives under shadcn/ui (`@radix-ui/react-dialog`, `-switch`, `-slider`, `-slot`), `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` and `gsap`. They run on the page that shows the words, so a new one needs a real reason, and each version must be at least a week old, with provenance where its project publishes it (gsap, clsx and class-variance-authority don't);
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
    - `health.js` (`sendHealth`: the cron's `payout_health` event for PostHog's alerts; see Alerts);
    - `node/` (`server.js` entry, `index.js` `startNodeServer`, `file-stores.js`);
    - `tidb/`: TiDB Cloud (MySQL) for either target, the production store:
      - `tidb-stores.js`;
      - `client.js`: `tidbDatabase`, Drizzle over the HTTPS driver;
      - `schema.js`, `migrations/`;
      - `migrate.js`, which is `npm run db:migrate`;
    - `cloudflare/`:
      - `worker.js` holds the only Cloudflare-specific code: `connect` from `cloudflare:sockets`, `WebSocketPair`, `cf-connecting-ip`;
      - `d1-stores.js` with its own `schema.js` and `migrations/`;
      - `wrangler.toml`, with a cron every 15 minutes for payouts, the share purge and the health event. It has `global_fetch_strictly_public` too, so the health check can fetch the site.
  - `site/`: the website, Next.js 16 App Router, plain JS: **one screen** (`app/page.js` renders `app/dashboard.js`), dark by default. `/wallet` and `/mine/:address` redirect to it (`next.config.mjs`).
    - **UI:** shadcn/ui components in plain JS (`components/ui/`, `components.json`, `cn` in `lib/utils.js`, `@/` imports through `jsconfig.json`) on Tailwind CSS v4 (`postcss.config.mjs`, theme variables in `app/globals.css`), with GSAP for the motion. No daisyUI, which fights shadcn's theme.
    - **The graph** (`components/hashrate-chart.js`) is a canvas redrawn only when the miner reports (every 2 s), not a chart library. Switched off, it isn't mounted at all. Keep it that cheap: it shares the CPU with mining.
    - **The state** lives in `lib/hooks.js`: `useMiner` (consent-first: the miner loads only on Start), `usePayouts`, `useHour`, `useSavedAddress`. The analytics events and their names stay as they are, because the PostHog alerts count them.
    - **Words and addresses** render with `translate="no"` and the `notranslate` class. Fields that hold either have spellcheck, autocomplete and autocorrect off. The words live only in `components/wallet-dialog.js`'s state, and never in a URL.
    - Client components (`'use client'`) import `tau-crypto/wallet`.
    - The library is copied in, not linked: `scripts/copy-library.mjs` copies `tau-crypto/dist` (on every build) to `lib/tau-crypto/` (imported as `tau-crypto/*` through `jsconfig.json`) and `public/tau-crypto/` (the miner, which the mine page loads at run time, so it is never bundled). The app needs nothing outside its folder, which OpenNext requires.
    - Server code reads `PAYOUT_API_URL`, `BRIDGE_URL`, `POOL_URL`, `NETWORK`, `POSTHOG_KEY` and `POSTHOG_HOST` at request time (the root layout is `force-dynamic` for this). `wrangler.jsonc` and `open-next.config.ts` are the Cloudflare (OpenNext) target; Vercel needs nothing extra.
    - `wrangler.jsonc` has `global_fetch_strictly_public`: both Workers are on the same workers.dev subdomain, and without it the site's calls to the payout Worker fail (error 1042).
  - `test/`: server and site tests. `docker/bitcoind/`: the regtest node image.
- Never re-add a facade that mixes client and server exports (the old `btc.js`): it breaks `'use client'` / `'use server'`.
- Server code imports the library's committed `dist/`. After changing library code, run `tau-crypto/dev build` and commit `dist/`.
- The payout Worker must not import `dist/index.js` (it would bundle the WASM miner). `server/test/regtest-worker.test.js` checks the bundle; `tau-crypto/test/entries.test.ts` checks that the edge entries carry no Node built-ins, WASM or Cloudflare names.

## Analytics (PostHog: the site, plus the payout Worker's health event)

The page shows a new wallet's 12 words, and the site promises they never leave the device. So `site/lib/analytics.js` sends only what the site chooses:
- **Never re-enable page-reading features:** autocapture, session replay, heatmaps, surveys, exception autocapture (it loads a script), remote config (`advanced_disable_flags`), or external scripts (`disable_external_dependency_loading`).
- **Events are explicit:** `track(name, props)` calls, page views and uncaught errors (`posthog.captureException` on the window's error events).
- **Props never carry words or addresses.** `before_send` (`prepareEvent`) also replaces every Bitcoin address with `[address]` and adds `app: "project-tau"` to every event. The PostHog project (702597) is Project Tau's own; `app` still marks every event, the health event's included.
- **Keys:** only the public `phc_` project key goes in config (the site's `POSTHOG_KEY`, the payout Worker's `TAU_POSTHOG_KEY`). A personal API key (`phx_`) never goes in either Worker, their settings or the repository. `server/test/config.test.js` checks both wrangler files.
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
