# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout (keep it: two folders)

The top level holds only these; don't add top-level folders or files:
- `tau-crypto/` (the library);
- `server/` (everything deployed, with its tests and tooling);
- `README.md`, `CLAUDE.md`, `docker-compose.yml` (server/'s containers) and `.gitignore`;
- `mine-btc-24-themes.html`: the owner's design prototype (one standalone page, never deployed or built). Its panels are headed "₿itrush" (the same `.btc-b`), with the theme's name beside it. It has the 26 themes, the setup-first flow and the visitor's tutorial on how Bitcoin mining works, which opens on a first visit (`localStorage` `tau.tutorial`) and again from "See tutorial" on the miner. Its hashing is a demo that connects to nothing. It loads Google Fonts, which the site must never do.

There is no upstream clone. `tau-crypto/dev vendor` fetches the pinned cpuminer-opt into the library's cache volume. There is no `.github/`: the alerts live in PostHog (GitHub's scheduled runs were hours apart).

## Alerts (PostHog)

Five alerts in Project Tau's PostHog project (702597, US Cloud), each named for its cause. They are checked hourly and emailed to the owner. They and the "Project Tau" dashboard were made through PostHog's API with the owner's personal key, which never goes in the repo.
- **What visitors' pages report** (the current hour): `blocks_seen` over 0, `$exception` over 0, `mining_unavailable` over 0, `mining_error` over 10.
- **The payout service:**
  - Every cron run (every 15 minutes) sends a `payout_health` event (`server/health.js`, from `scheduled` in `cloudflare/worker.js`). It carries `can_pay`, `sweep_ok`, `purge_ok`, `site_ok` (the site's `/api/address`, which also proves the site reaches this service) and `ok`.
  - Its alert, "payout service unhealthy or silent", looks at the last complete hour: A (events with `ok` true) − 10 × B (events with `ok` false) below 1. So it fires on silence (a broken deploy, settings or cron sends nothing) and on any bad event.
  - **Telemetry (Logs and Metrics):** the same cron run also sends, best-effort, one OTLP log line and the health booleans as 0/1 gauges (`server/otel.js`, OTLP/JSON to `{host}/i/v1/logs` and `/i/v1/metrics`, the same `phc_` key), so it shows in PostHog's Logs and Metrics too. The alert of record is still `payout_health`; a telemetry failure never touches it or payouts. Same rule (booleans and public settings only). No OpenTelemetry SDK: the bodies are built by hand (`server/test/otel.test.js`). Metrics is in alpha, its endpoint may change.
- **The event:** booleans and public settings only, never a secret, an address or anything about a visitor.
  - Settings: `TAU_POSTHOG_KEY` (a `phc_` project key; `healthTarget` refuses anything else), `TAU_POSTHOG_HOST` and `TAU_SITE_URL`.
  - A missing or unusable value stops the event (and so fires the alert), never the service.

## Rules

- **Everything runs in Docker.** Never run node, npm, tsc, emcc, wrangler, next or tests on the host. Library: `tau-crypto/dev <cmd>` (see `tau-crypto/CLAUDE.md`). Server: `server/dev <cmd>` (it uses the top-level `docker-compose.yml`, working directory `server/`).
- **No live mining or real-network pool connections from this machine.** Tests use mocks, a private regtest bitcoind (`docker compose` service `bitcoind`: no peers, `-connect=0`), a local TiDB (service `tidb`, in memory) and local workerd via Miniflare / `wrangler dev`. Never `wrangler deploy`, `wrangler login`, `opennextjs-cloudflare deploy`, `vercel`, `server/dev db migrate` / `npm run db:migrate` or anything else that touches the user's TiDB Cloud: deployment is the user's step with their own accounts. The connection string (`DB_PASSWORD`) never goes into a file. wrangler and Next.js telemetry are off in the containers (`WRANGLER_SEND_METRICS`, `NEXT_TELEMETRY_DISABLED`).
- **Consent-first:** nothing mines until a visitor presses the mine button (that press is the consent; there's no separate checkbox). Don't add stealth features.
- The GitHub repo is public (nothing secret goes in it), with no license, and is not published to npm. Dependencies are exact-pinned and installed with `--ignore-scripts`. The library's runtime dependencies need the AUDIT.md treatment. These get `npm audit signatures`:
  - the site's framework dependencies (next, react, OpenNext);
  - its analytics, posthog-js: a release at least a week old, with provenance;
  - its UI: Tailwind CSS v4 (`tailwindcss`, `@tailwindcss/postcss`, `postcss`; build time only), the Radix primitives under shadcn/ui (`@radix-ui/react-dialog`, `-switch`, `-slider`, `-slot`), `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` and `gsap`. They run on the page that shows the words, so a new one needs a real reason, and each version must be at least a week old, with provenance where its project publishes it (gsap, clsx and class-variance-authority don't);
  - the themes' fonts: 13 `@fontsource/*` packages (CSS and font files only, with provenance), imported in `app/fonts.js`. Never load fonts from Google or another host: the page would then talk to a third party;
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
  - `site/`: the website, Next.js 16 App Router, plain JS: **one screen** (`app/page.js` renders `app/dashboard.js`). `/wallet` and `/mine/:address` redirect to it (`next.config.mjs`).
    - **Its name is Bitrush** (the owner's domain: bitrush.online), shown by `components/wordmark.js` as "₿itrush". The themes' fonts (Latin only) have no ₿, so `.btc-b` (`app/globals.css`) draws it: the theme's own B with two strokes, placed with `text-box`. The repository, the library and the analytics `app` (`project-tau`) keep their names.
    - **A first visit opens with the tutorial** (`components/tutorial.js`), which explains how Bitcoin mining works to a visitor new to it, in plain words. It shows until it's closed once (skipped or finished), which `useTutorial` remembers in `localStorage` (`tau.tutorial`). "See tutorial" in the miner's header opens it again in a dialog, and mining carries on underneath.
      - Keep its claims true: the numbers (3.125 BTC, about 19 zeros, 100 confirmations) date from 2026.
      - Its guess game hashes in the browser (Web Crypto) and sends nothing.
      - As in the rest of the site, there's no 10% or "lottery ticket" copy.
    - **SEO** (`lib/site.js`: the name, `SITE_URL` bitrush.online, the description, keywords and the structured data):
      - `app/layout.js`'s metadata: canonical, Open Graph, Twitter card, robots, and JSON-LD (WebSite, WebApplication, and an FAQPage in the tutorial's words); a `<noscript>` says what the page is;
      - `app/robots.js`, `app/sitemap.js`, `app/manifest.js` and `public/llms.txt`; www.bitrush.online redirects to bitrush.online (`next.config.mjs`);
      - the icons and share image (`app/icon.svg`, `apple-icon.png`, `favicon.ico`, `opengraph-image.png`, `twitter-image.png`, `public/icon-*.png`) are one pixel-art ₿ in Arcade's colors, made by `scripts/brand-images.mjs` and committed. After changing the look, run it again in Docker: `server/dev shell node site/scripts/brand-images.mjs`.
      - Keep the FAQ and `llms.txt` true to the tutorial and the page, with the same copy rules (no 10%, lottery or earnings claims).
    - **Then the wallet setup** (`components/wallet-setup.js`): until the device has a payout address, there is no mine button at all. It offers three ways: create a wallet (`components/recovery-phrase.js`, with a "saved it" confirmation), upload a file (`readWalletFile` in `lib/backup.js`) or paste an address. The miner's "Change" returns to it.
    - **UI:** shadcn/ui components in plain JS (`components/ui/`, `components.json`, `cn` in `lib/utils.js`, `@/` imports through `jsconfig.json`) on Tailwind CSS v4 (`postcss.config.mjs`, `app/globals.css`), with GSAP for the motion. No daisyUI, which fights shadcn's theme.
    - **Themes:** `lib/themes.js` lists them (Arcade is the default, on `<html data-theme>`), `app/themes.css` styles them, and `components/theme-picker.js` switches them.
      - Each theme sets `--t-*` tokens, which `[data-theme]` maps onto shadcn's. Each has its own `.mine-btn` look.
      - Components use the tokens (`bg-primary`, `font-display`, `font-num`, `font-mono`), never fixed colors, so every theme applies.
      - `THEME_SCRIPT`, a constant inline script in `<head>`, applies the saved theme before paint.
    - **The graph** (`components/hashrate-chart.js`) is a canvas redrawn only when the miner reports (every 2 s), not a chart library. Switched off, it isn't mounted at all. Keep it that cheap: it shares the CPU with mining.
    - **The state** lives in `lib/hooks.js`: `useMiner` (consent-first: the miner loads only on Start), `usePayouts`, `useHour`, `useSavedAddress`. The analytics events and their names stay as they are, because the PostHog alerts count them.
      - The Speed slider is a number from 0 to 100 (step 1). It sets the library's throttle, `(100 − speed) / 100`, which idles the CPU workers and the GPU alike, down to 1%; 0 pauses the miner (`pause()`, still connected). It applies at every step of a drag, and `mining_speed_changed` is sent once, when the drag ends (`onValueCommit`).
    - **Words and addresses** render with `translate="no"` and the `notranslate` class. Fields that hold either have spellcheck, autocomplete and autocorrect off. The words live only in the setup's state while it shows them, and never in a URL. Upload errors show our own fixed messages, never the file's content.
    - Client components (`'use client'`) import `tau-crypto/wallet`.
    - The library is copied in, not linked: `scripts/copy-library.mjs` copies `tau-crypto/dist` (on every build) to `lib/tau-crypto/` (imported as `tau-crypto/*` through `jsconfig.json`) and `public/tau-crypto/` (the miner, which the mine page loads at run time, so it is never bundled). The app needs nothing outside its folder, which OpenNext requires.
      - `public/tau-crypto/` holds only what the miner loads (`index.js` and the chunks it imports, statically or with `import()`), minified with esbuild (an exact-pinned dev dependency, the library's version), with source maps. The mining worker's source, which the library inlines as a string literal (`WORKER_SOURCE`), is minified too; the copy fails unless it finds exactly one. `server/test/site.test.js` checks that the served miner is minified and that `payouts.js`, `bridge.js` and `wallet.js` aren't served.
      - The hash rate is unchanged: the WASM (gzip+base64 inside the variant chunks) and the WebGPU shader are strings, which minification leaves byte for byte. An A/B benchmark in Chromium measured within noise (CPU ×1.045, GPU ×0.973, the pure-JS fallback ×0.996). `lib/tau-crypto/` stays as built: Next.js bundles and minifies what pages import, and server code reads it as is.
    - Server code reads `PAYOUT_API_URL`, `BRIDGE_URL`, `POOL_URL`, `NETWORK`, `POSTHOG_KEY` and `POSTHOG_HOST` at request time (the root layout is `force-dynamic` for this). `wrangler.jsonc` and `open-next.config.ts` are the Cloudflare (OpenNext) target; Vercel needs nothing extra.
    - `wrangler.jsonc` has `global_fetch_strictly_public`: both Workers are on the same workers.dev subdomain, and without it the site's calls to the payout Worker fail (error 1042).
    - The site is served on bitrush.online and www.bitrush.online (custom domains in `wrangler.jsonc`'s `routes`; the zone's DNS is on Cloudflare, the domain registered at Namecheap) and on its workers.dev address. The payout Worker's `TAU_ORIGINS` lists all three (its WebSocket refuses other origins), and `TAU_SITE_URL` (the health check) is bitrush.online. The zone's security challenges (Under Attack, Bot Fight Mode) must stay off: they answer the health check, link previews and crawlers with a 403.
  - `test/`: server and site tests. `docker/bitcoind/`: the regtest node image.
- Never re-add a facade that mixes client and server exports (the old `btc.js`): it breaks `'use client'` / `'use server'`.
- Server code imports the library's committed `dist/`. After changing library code, run `tau-crypto/dev build` and commit `dist/`.
- The payout Worker must not import `dist/index.js` (it would bundle the WASM miner). `server/test/regtest-worker.test.js` checks the bundle; `tau-crypto/test/entries.test.ts` checks that the edge entries carry no Node built-ins, WASM or Cloudflare names.

## Analytics (PostHog: the site, plus the payout Worker's health event)

The page shows a new wallet's 12 words, and the site promises they never leave the device. So `site/lib/analytics.js` sends only what the site chooses:
- **Session replay is on, but masked, and the words are never recorded.** The words' element is dropped from the recording entirely (`ph-no-capture` in `components/recovery-phrase.js`), and on top of that every input value and all `.notranslate` text (the words, every address, the backup box) are masked before anything is serialized (`session_recording` in `lib/analytics.js`, `initOptions`). Recording is still gated by PostHog's "Record user sessions" project setting — off there, nothing records. Loading the recorder re-enables two things that were off: remote config (the `/flags` request; `advanced_disable_flags` removed) and external-script loading (`disable_external_dependency_loading: false`). That is bounded: the `initOptions` config is the ceiling — a feature off there stays off — so remote config can turn on **only** session replay, never autocapture, heatmaps, surveys, exception autocapture or the rest, and the recorder is the only script PostHog loads.
- **Still off — the ceiling, never re-enable:** autocapture, heatmaps, dead clicks, rageclick, surveys, web experiments, product tours, and exception autocapture (`capture_exceptions: false`; uncaught errors use the core `captureException`, which loads no script). Replay's masking (`maskAllInputs`, `maskTextSelector: '.notranslate'`) and the `ph-no-capture` on the words are not optional — never narrow them so the words or an address could be recorded.
- **Events are explicit:** `track(name, props)` calls, page views and uncaught errors (`posthog.captureException` on the window's error events). Web vitals are captured too (`capture_performance: { web_vitals: true }`): CLS/FCP/LCP/INP — performance numbers and element selectors, never page text or input values; network timing stays off.
- **posthog-js loads late:** `startAnalytics` imports it (its own chunk) after the page has shown, so it doesn't hold up the first paint. Calls made while it loads (`track`, errors) wait in a queue and are sent once it has started.
- **Events and the recorder go first-party:** the browser sends them to a same-origin path (`api_host` is `/ingest`, `lib/config.js`), which `app/ingest/[...path]/route.js` proxies to PostHog — events to the ingestion host (`POSTHOG_HOST`) and `/ingest/static/*` (the replay recorder) to its assets host (`posthogAssetsHost`: `us-assets`/`eu-assets` on Cloud, the host itself otherwise). Ad blockers block PostHog's own domains and silently drop 10-25% of events and the recorder; a first-party path they don't. The proxy forwards only what the browser already sends, to fixed hosts (not an open proxy), and doesn't forward the visitor's IP (so it adds nothing about a visitor; PostHog geolocates the Worker, not them). `ui_host` keeps "view in PostHog" links working. `server/test/site.test.js` checks the browser uses `/ingest` and that the recorder path is forwarded.
- **Props never carry words or addresses.** `before_send` (`prepareEvent`) also replaces every Bitcoin address with `[address]` and adds `app: "project-tau"` to every event. The PostHog project (702597) is Project Tau's own; `app` still marks every event, the health event's included.
- **Keys:** only the public `phc_` project key goes in config (the site's `POSTHOG_KEY`, the payout Worker's `TAU_POSTHOG_KEY`). A personal API key (`phx_`) never goes in either Worker, their settings or the repository. `server/test/config.test.js` checks both wrangler files.
- **Tests:**
  - `server/test/site.test.js` runs the whole flow against a stand-in PostHog (`startFakePostHog`, which answers `/flags` with replay off). It fails if any request contains the words, two adjacent words or an address, and it checks the words' element carries `ph-no-capture` and that the recorder loads through `/ingest`. `server/test/analytics.test.js` locks the masking config (`initOptions`) and the assets-host helper.
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
