# Project_tau

Browser Bitcoin mining where visitors keep a share of the blocks they find.

- **Visitors mine to our wallet.** They mine in their browser through our **payout bridge**, which logs them in to the pool with a **fresh address of our wallet every hour**. Every block pays us.
- **The finder gets 10%.** If a visitor's miner finds a block, we verify that it did, then send them **10%** of what we received. The percentage is a setting, and we pay the network fee.

> **Consent and odds.** Mining runs the visitor's CPU. Only start it after they agree, and tell them about the split. Also tell them the odds: one browser at ~10 MH/s finds a Bitcoin block about once in 2 billion years, so this is a lottery ticket, not income.

## Two folders

| folder | what |
|---|---|
| [`tau-crypto/`](tau-crypto/README.md) | **the crypto library**: mining (cpuminer-opt compiled to WebAssembly), wallets and watch-only addresses, payments, payout proofs, the share auditor, `createPayoutService`, and the bridges. Mechanisms only: every value is a parameter, and it has no keys, storage or platform code of its own. |
| `server/` | **everything we deploy**, built on the library: the payout service (Node or a Cloudflare Worker), the website (Next.js, for Vercel or Cloudflare), their tests and tooling. |

Inside `server/`:

| path | what |
|---|---|
| `config.js`, `api.js` | the payout service's settings (`TAU_*`), and its HTTP API as a web-standard `fetch(request)`: `GET /address`, `POST /payout`, `GET /health` |
| `node/` | the Node target: `server.js` serves the bridge and the API on one port; records are kept as files, or in TiDB |
| `cloudflare/` | the Cloudflare target: `worker.js` (the only Cloudflare-specific code), `wrangler.toml`; the D1 store, if you use D1 instead of TiDB |
| `tidb/` | the TiDB Cloud store (MySQL), for either target: the Drizzle schema, its migrations and `migrate.js` |
| `site/` | the website (Next.js 16): wallet, consent-first mining, payout status |
| `test/`, `docker/`, `dev` | the tests, the regtest bitcoind image, the `server/dev` commands |

## Architecture

```mermaid
flowchart LR
  client["Client<br/>the visitor's browser:<br/>website, wallet, miner"]
  server["Server<br/>Cloudflare Workers:<br/>website, payout API, mining bridge"]
  db[("DB<br/>TiDB Cloud (MySQL)")]
  client -->|"HTTPS: pages, payout checks"| server
  client <-->|"WebSocket: mining"| server
  server <-->|"shares, payouts"| db
```

The server also talks to the mining pool and the Bitcoin network.

### Hourly addresses

Slot N (one an hour) is receive index N of our wallet: `1 + whole hours since TAU_ADDRESS_EPOCH`.
- Everyone mining in that hour mines to that address.
- Who gets paid comes from the share records, not from the address.
- Index 0 is our main address. After each payout, our 90% goes there.
- Slots are sequential, so any hour's address can be worked out again from the time: `newAddress({ xpub }, { index })` with the library. A reward that hasn't been paid can therefore always be found.

## The website (`server/site`)

**One screen**, in 26 themes: Arcade by default; the theme button switches and remembers the choice on the device. Built with shadcn/ui on Tailwind CSS v4, with GSAP for the motion.
- **Themes:** the 24 of the theme set (Ledger, Vault, Blueprint, Terminal, Neon, … the casinos), plus Tau, the earlier look, dark and light. Each has its colors, fonts, background and its own mine button. The fonts are self-hosted from npm (`@fontsource`), so the page never calls Google Fonts.
- **Left, the miner:**
  - the **mine button**: nothing loads or mines until it's pressed; pressed again, it stops. Mining pauses when the tab is hidden;
  - your hashrate (big, animated), shares, uptime, threads, the block being mined, and a speed slider;
  - a **live graph** of the last 3 minutes. Switch it off and the CPU it used goes to mining.
- **Right, the details:**
  - **your payout address**. Paste one you have, **create a wallet** on the spot, or **restore** one from its backup file. The wallet is made in the browser, and its 12 words never reach us. They show in a dialog where you can:
    - **download** a `.txt` backup;
    - **copy** the words;
    - **share** them: the phone's share sheet (WhatsApp, Telegram, SMS), or a text box on a laptop. A warning comes first: anyone who has the words can spend, and sending them by message stores them on that service.

    The device remembers only the address, never in a URL. The words and addresses are marked `translate="no"`, and the backup box has spellcheck off, so neither page translation nor a spellcheck service sees them.
  - **this hour's mining address**, rendered on the server, with a countdown to the next one;
  - **your blocks**: each block you found, waiting for 100 confirmations (with progress) or paid (with the transaction). Confetti when one appears.
- **Old links:** `/wallet` and `/mine/<address>` redirect to the one screen.
- **The library is copied in at build time.** `tau-crypto/dist` goes to `lib/tau-crypto/` (what the page imports) and to `public/tau-crypto/` (the miner). The page loads the miner only when you press Start, so it is never bundled.
- **Analytics (PostHog)**, when `POSTHOG_KEY` is set (`lib/analytics.js`). Only what the site sends itself:
  - page views (`/` only now; Bitcoin addresses are cut out of everything anyway);
  - uncaught errors, for PostHog's error tracking. The browser source maps are served next to the scripts (`next.config.mjs`), so stack traces resolve without an upload step;
  - named events, none of which carry words or addresses: wallet created, backup downloaded, words copied or shared, wallet restored, payout address chosen, mining start, stop, speed, errors and unavailable, payout checks, blocks seen, live graph switched, theme changed.

  Nothing reads the page: no autocapture, session replay, heatmaps or surveys, and no remote config or scripts from PostHog, because the page shows a new wallet's 12 words. Every event carries `app: "project-tau"`. The page says analytics is on.

## Settings

**The payout service** (`server/`). On Node these are environment variables; on Cloudflare they're the `[vars]` in `server/cloudflare/wrangler.toml`.

| variable | default | meaning |
|---|---|---|
| `TAU_OWNER_ADDRESS` | required | our wallet's first address (index 0): payout change goes here |
| `TAU_ADDRESS_PERIOD_MS`, `TAU_ADDRESS_EPOCH` | `3600000`, `2026-01-01T00:00:00Z` | a fresh address every hour, counted from the epoch; `0` puts every block on `TAU_OWNER_ADDRESS` |
| `TAU_OWNER_XPUB` | none | our wallet's account public key (`accountXpub`). It derives the hourly addresses without the words, but reveals all of them, so make it a secret. Not needed when `OWNER_MNEMONIC` is set. |
| `OWNER_MNEMONIC` | none | our wallet's words: only these can pay. Without them, shares are recorded and nothing is paid. |
| `TAU_CLIENT_SHARE_PERCENT` | `10` | the finder's share of our block reward, whole percent |
| `TAU_POOL` | `stratum+tcp://solo.ckpool.org:3333` | the only pool the bridge connects to |
| `TAU_NETWORK` | `mainnet` | or `testnet`, `regtest` |
| `TAU_CHAIN`, `TAU_CHAIN_URL` | `esplora`, `https://mempool.space/api` | or `bitcoin-core` with `TAU_CHAIN_USER` / `TAU_CHAIN_PASS` for your own node |
| `TAU_STORAGE` | `file` (Node), `d1` (Cloudflare); our `wrangler.toml` sets `tidb` | `tidb`: TiDB Cloud on either target, tables in the database `TAU_DB_NAME` (default `tau`); `file`: `TAU_STORAGE_DIR` (default `payout-ledger`); `d1`: `TAU_D1_BINDING` (default `DB`) |
| `DB_PASSWORD` | none | a secret: TiDB Cloud's connection string, `mysql://user:password@host:4000/db`, for `tidb` |
| `TAU_SHARE_RETENTION_DAYS` | `30` | ordinary shares older than this are deleted by each cron run (Node: hourly); blocks and payouts are always kept. `0` keeps everything. |
| `TAU_ORIGINS` | none | web pages allowed to connect and call the API directly, comma-separated |
| `TAU_POSTHOG_KEY`, `TAU_POSTHOG_HOST` | none, `https://us.i.posthog.com` | where each cron run sends its health event (see Alerts): PostHog's public project key (`phc_…`), never a personal key. Unset or unusable: no event, which the health alert reports. |
| `TAU_SITE_URL` | none | the site, whose `/api/address` each health event checks |
| `TAU_MIN_CONFIRMATIONS`, `TAU_MAX_FEE_RATE` | `100`, `200` | the minimum confirmations before paying (at least 100); the most it will pay in fees, in sat/vB |
| `TAU_LISTEN`, `TAU_HOST`, `TAU_SWEEP_INTERVAL_MS` | `8080`, all interfaces, `0` | Node only. The sweep pays every visitor with a mature block on a timer; on Cloudflare, use the cron trigger. |

Make our wallet a dedicated one with `createWallet()`, not a personal seed. The service refuses to start if the words or the xpub don't belong to `TAU_OWNER_ADDRESS`.

**The site** (`server/site`) reads these at request time, so one build works anywhere. On Vercel they're environment variables; on Cloudflare they're the `vars` in `server/site/wrangler.jsonc`.

| variable | meaning |
|---|---|
| `PAYOUT_API_URL` | the payout service's URL. The site's server calls it; the browser doesn't. |
| `BRIDGE_URL` | where browsers mine: the payout service's `wss://` address |
| `POOL_URL` | the pool that bridge allows (default `stratum+tcp://solo.ckpool.org:3333`) |
| `NETWORK` | `mainnet` (default), `testnet` or `regtest` |
| `POSTHOG_KEY`, `POSTHOG_HOST` | PostHog's public project key (`phc_…`; unset: no analytics) and its host (default `https://us.i.posthog.com`). Never the personal API key (`phx_…`). |

## Database

The payout service keeps its records in **TiDB Cloud** (MySQL), through **Drizzle**. It can also use Cloudflare D1, or plain files on Node.
- **Tables:** `tidb/schema.js` (D1: `cloudflare/schema.js`) holds four tables: shares, the pool's verdicts on them, payouts, and the coins each payout spends.
- **Migrations:** they're SQL files generated from the schema by drizzle-kit, in `tidb/migrations/` (D1: `cloudflare/migrations/`). They're committed, and they are the only thing that creates or changes tables.
  - After editing a schema, run `server/dev db generate <name>` and commit the new migration. A test fails if a schema changed without one.
  - Never edit a migration that has been applied.
- **Applying them:** for TiDB, `npm run db:migrate` (`tidb/migrate.js`). It creates the database `tau` if needed and runs the migrations it hasn't run yet. Run it before deploying a version that brings a migration. For D1, run `wrangler d1 migrations apply`.
- **Growth:** ordinary shares older than `TAU_SHARE_RETENTION_DAYS` are purged by the Worker's cron (every 15 minutes) or the Node timer (hourly). Blocks and payouts stay.

## Deploy

**Vercel can host the site but not the bridge**, which needs WebSockets and raw TCP. The payout service therefore runs as a Cloudflare Worker or on a Node server. Every step below runs under your own accounts.

**Payout service, as a Cloudflare Worker.** From `server/`, after `server/dev setup`:

```sh
# edit cloudflare/wrangler.toml: TAU_OWNER_ADDRESS, TAU_ORIGINS
npx wrangler secret put OWNER_MNEMONIC -c cloudflare/wrangler.toml
npx wrangler secret put DB_PASSWORD -c cloudflare/wrangler.toml      # TiDB Cloud's connection string
DB_PASSWORD='mysql://…' npm run db:migrate                          # the tables, before the first deploy
npx wrangler deploy -c cloudflare/wrangler.toml
```

Or connect the repository in the Cloudflare dashboard (Workers Builds), as a Worker named like the `name` in `wrangler.toml` (`project-tau`):
- Root directory: `server`. With the default `/`, the build fails: the top level has no Worker in it.
- Build command: `npm ci --ignore-scripts`.
- Deploy command: `npm run db:migrate && npx wrangler deploy -c cloudflare/wrangler.toml`.
- Add `OWNER_MNEMONIC` and `DB_PASSWORD` as the Worker's secrets (Settings → Variables and Secrets).
- Add `DB_PASSWORD` again as a **build** variable (Settings → Build → Variables and secrets), since the migrate step runs during the build.

For D1 instead of TiDB, see the end of `wrangler.toml`.

Things to check on Cloudflare:
- Workers can't open connections to private or localhost addresses, so the pool must be public.
- Long connections may hit the free plan's CPU limits. The miner reconnects by itself, but the paid plan is the safer choice.
- The pool sees every visitor arriving from Cloudflare's addresses and may limit that.

**Payout service, on Node:**

```sh
TAU_OWNER_ADDRESS=bc1q… OWNER_MNEMONIC="…" node server/node/server.js
```

The bridge doesn't do TLS itself, so for `wss://` put it behind nginx or Caddy.

**The site, on Vercel:** create a project with **Root Directory `server/site`**. Vercel builds it with the repository around it, which it needs, because the build copies the library from `tau-crypto/dist`. Set the four site variables.

**The site, on Cloudflare:** edit the `vars` in `server/site/wrangler.jsonc`, then, from `server/site`, run `npm run cf:build` and `npm run cf:deploy`. It deploys as a second Worker, next to the payout Worker. In the dashboard (Workers Builds), connect it as a Worker named `tau-site`:
- Root directory: `server/site`.
- Build command: `npm ci --ignore-scripts && npm run cf:build`.
- Deploy command: `npm run cf:deploy`.
- It needs no secrets.

## Alerts

Five alerts in Project Tau's PostHog project, each named for its cause. PostHog checks them every hour and emails the owner.

| Alert | Fires when |
|---|---|
| a visitor's miner found a block | `blocks_seen` this hour |
| errors in visitors' browsers | `$exception` this hour |
| visitors saw "mining unavailable" | `mining_unavailable` this hour |
| mining errors (over 10 an hour) | over 10 `mining_error` this hour |
| payout service unhealthy or silent | the last full hour had no good `payout_health` event, or a bad one |

The payout Worker's cron runs every 15 minutes. Each run sends a `payout_health` event (`server/health.js`): `can_pay` (the words are set), `sweep_ok` (the payout sweep ran), `purge_ok` (the share purge ran), `site_ok` (the site's `/api/address` answers, so the site is up and reaches the payout Worker) and `ok`. A broken deploy, setting or cron sends nothing, which fires the alert just the same. The events hold only these booleans. The "Project Tau" dashboard in PostHog shows them, with the visitor events.

Dependabot and secret scanning alerts are repository settings, which only the owner can turn on (Settings, in its Security section).

## How a win is verified

Nothing a visitor says is trusted.

1. **The bridge sees everything.** Every visitor's miner talks to the pool through our bridge. The bridge sees each job the pool sends and each share the miner submits, on a connection tied to the visitor's payout address (one per connection). The pool only ever sees our address for that hour.
2. **Each share is recorded before the pool sees it.** The share auditor rebuilds the share's block header itself and hashes it, so proof of work can't be faked. It records the raw share, which of our addresses the connection used, and whether the share is a block. Only then does it forward the share.
3. **`verifyPayout` confirms the block on the blockchain.** It rebuilds each recorded block from the raw fields, never trusting a stored hash, and pays only if all of these hold:
   - the block is in the best chain;
   - it has at least 100 confirmations, so a reorg can't undo it;
   - its coinbase transaction is exactly the one built from that visitor's share;
   - that coinbase pays our address for the share's hour. The service derives that address from our words; it never takes it from the record.
4. **Each block is paid at most once.** The payout spends that block's reward, from that hour's address. It's reserved before it's broadcast: one atomic step claims the block and the exact coins. That step is one transaction in TiDB (one batch in D1, a lock file for the file store), relying on primary keys on the block and on each coin. Then it's marked `sent`.

What it refuses, and why:

| attempt | why it fails |
|---|---|
| claiming a block they didn't find | the block must be on-chain, and its header and coinbase must match the visitor's own recorded share |
| getting someone else's payout | a win belongs to the connection that submitted the share; `verifyPayout(a)` only pays `a`, for `a`'s blocks. Sharing an hour's address doesn't change that. |
| mining to their own address through our site | the bridge replaces their pool login with our address for the hour |
| picking which of our addresses to mine to | only the current hour, or the one before (for pages loaded just before the hour turned) |
| getting paid twice | one reservation per block and per coin, even across processes or Workers; a crashed attempt stays `needs-review` |
| protocol tricks | only five stratum messages are allowed; JSON is re-serialized after checking; hex fields and sizes are validated; version rolling is refused; submits are rate-limited |

`verifyPayout` reports one status per block:

| status | meaning |
|---|---|
| `paid` | the payout was sent now |
| `already-paid` | the block was paid before |
| `immature` | under 100 confirmations; ask again later |
| `not-in-chain` | not a block in the best chain (stale, orphaned or unknown) |
| `not-ours` | the coinbase on the chain isn't the share's, or doesn't pay our address for that hour |
| `not-paid-yet` | verified, but the payment couldn't be built yet, e.g. no mature funds, or fees above the cap |
| `needs-review` | a payment was started but not confirmed as sent |

For `needs-review`, first look the txid up on a block explorer. If it never reached the chain, release the attempt with `ledger.void(blockHash)` on the store (`server/tidb/tidb-stores.js`, `server/cloudflare/d1-stores.js` or `server/node/file-stores.js`). The retry builds the identical transaction, so the visitor is never paid twice.

## Security notes

- **Our wallet is a hot wallet** on either target. Every block reward lands in it, so move our 90% from its first address to cold storage after a win.
- **The xpub is a privacy secret.** It can't spend, but it reveals every address of the wallet.
- **Words shared by message** sit on that messaging service. The site warns visitors before it shares. It never stores the words itself; only the visitor's download, copy or share puts them anywhere.
- **The records are trusted.** Anyone who can write our share records could also read `OWNER_MNEMONIC`, so protect the server, the Cloudflare account and the database. `DB_PASSWORD` is a secret: keep it in the Worker's secrets (and GitHub's, if you use them), never in `wrangler.toml` or the repository.
- **The crypto libraries were reviewed.** The wallet and transaction code is Paul Miller's audited `@scure`/`@noble` libraries, pinned exactly and bundled into the library's `dist/`. The review is in [tau-crypto/AUDIT.md](tau-crypto/AUDIT.md). Other packages are pinned exactly and have verified npm registry signatures:
  - the site's framework packages (Next.js, React, OpenNext);
  - the site's analytics, posthog-js: a release at least a week old, with SLSA provenance. It runs on the page that shows the words, so it is limited as described above, and the site test checks that nothing it sends contains the words or an address;
  - the server's database packages (Drizzle, TiDB's driver).
- **PostHog's personal API key** (`phx_…`) manages the PostHog project. It never goes into the site, its settings or the repository.

## Development

Everything runs in Docker. The host only needs Docker.

```sh
tau-crypto/dev setup   # once: the library's images (the dev image is shared by server/)
server/dev setup       # the regtest bitcoind image; npm ci --ignore-scripts for server/ and server/site
server/dev test        # every server and site test (starts a fresh private regtest node and a local TiDB)
server/dev db generate <name>  # after editing a schema: the next migrations (commit them)
server/dev site build  # the site with next build;  server/dev site cf-build: with OpenNext for Cloudflare
server/dev bundle      # the payout Worker as `wrangler deploy` would build it
```

The tests run without any real network:
- a private **regtest** Bitcoin Core 32.1 node (no peers);
- a local TiDB;
- Cloudflare's runtime (`workerd`).

They cover:
- the settings and the API;
- the three storage adapters (TiDB, D1, files), against one contract. The SQL ones start empty and get their tables from the migrations, which must match the schemas;
- end to end on Node and on the Worker: the real miner mines to our address for the slot, bitcoind accepts the block, and once it's mature the visitor is paid exactly 10%, once, from that address, with our 90% back at our first address;
- the Worker's Cloudflare glue;
- the site in headless Chromium:
  - creating a wallet;
  - download, share, copy and restore;
  - the address rendered on the server;
  - consent, mining a block in the page, and seeing it paid.

The library's tests, build and dependency audit run with `tau-crypto/dev` (see its README).
