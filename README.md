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
| `node/` | the Node target: `server.js` serves the bridge and the API on one port; records are kept as files |
| `cloudflare/` | the Cloudflare target: `worker.js` (the only Cloudflare-specific code), records in D1, `wrangler.toml` |
| `site/` | the website (Next.js 16): wallet, consent-first mining, payout status |
| `test/`, `docker/`, `dev` | the tests, the regtest bitcoind image, the `server/dev` commands |

## How it works

```
visitor's browser (site)                   site server (Vercel or Cloudflare)      payout service (Node or Cloudflare Worker)
  wallet: created / entered / restored      /mine/[address] renders this hour's ───▶ GET /address: our address for this hour
  mines with mineBTC(address, bridge?slot=N) ─────────── wss ──────────────────────▶ bridge + auditor: pool login = that address
  payout status ──▶ /api/payout ──────────────────────────────────────────────────▶ POST /payout: verify, pay 10%, once
```

**Hourly addresses.** Slot N (one an hour) is receive index N of our wallet: `1 + whole hours since TAU_ADDRESS_EPOCH`.
- Everyone mining in that hour mines to that address.
- Who gets paid comes from the share records, not from the address.
- Index 0 is our main address. After each payout, our 90% goes there.
- Slots are sequential, so any hour's address can be worked out again from the time: `newAddress({ xpub }, { index })` with the library. A reward that hasn't been paid can therefore always be found.

## The website (`server/site`)

- **`/wallet`** offers three ways to get a payout address:
  - **enter an address** you already have;
  - **create a wallet** on the spot. It's made in the browser, and its 12 words never reach us. You can then:
    - **Download** a `.txt` backup;
    - **Copy** the words;
    - **Share** them: the phone's share sheet (WhatsApp, Telegram, SMS), or a text box on a laptop. A warning comes first: anyone who has the words can spend, and sending them by message stores them on that service;
  - **restore** from that backup file.

  The device remembers only the address.
- **`/mine/[address]`** shows this hour's mining address, rendered on the server. Mining needs an explicit "I agree" before Start. It shows the hash rate and shares, and has a speed control. It pauses when the page is hidden.
- **Your blocks** shows each block you found: waiting for 100 confirmations (with progress), or paid (with the transaction).
- **The library is copied in at build time.** `tau-crypto/dist` goes to `lib/tau-crypto/` (what the pages import) and to `public/tau-crypto/` (the miner). The page loads the miner only when you press Start, so it is never bundled.

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
| `TAU_STORAGE` | `file` (Node), `d1` (Cloudflare) | `TAU_STORAGE_DIR` (default `payout-ledger`), `TAU_D1_BINDING` (default `DB`) |
| `TAU_ORIGINS` | none | web pages allowed to connect and call the API directly, comma-separated |
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

## Deploy

**Vercel can host the site but not the bridge**, which needs WebSockets and raw TCP. The payout service therefore runs as a Cloudflare Worker or on a Node server. Every step below runs under your own accounts.

**Payout service, as a Cloudflare Worker.** From `server/`, after `server/dev setup`:

```sh
npx wrangler d1 create tau-payouts -c cloudflare/wrangler.toml          # put the id into wrangler.toml
# edit cloudflare/wrangler.toml: TAU_OWNER_ADDRESS, TAU_ORIGINS
npx wrangler secret put OWNER_MNEMONIC -c cloudflare/wrangler.toml
npx wrangler deploy -c cloudflare/wrangler.toml
```

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

**The site, on Cloudflare:** edit the `vars` in `server/site/wrangler.jsonc`, then, from `server/site`, run `npm run cf:build` and `npm run cf:deploy`. It deploys as a second Worker, next to the payout Worker.

## How a win is verified

Nothing a visitor says is trusted.

1. **The bridge sees everything.** Every visitor's miner talks to the pool through our bridge. The bridge sees each job the pool sends and each share the miner submits, on a connection tied to the visitor's payout address (one per connection). The pool only ever sees our address for that hour.
2. **Each share is recorded before the pool sees it.** The share auditor rebuilds the share's block header itself and hashes it, so proof of work can't be faked. It records the raw share, which of our addresses the connection used, and whether the share is a block. Only then does it forward the share.
3. **`verifyPayout` confirms the block on the blockchain.** It rebuilds each recorded block from the raw fields, never trusting a stored hash, and pays only if all of these hold:
   - the block is in the best chain;
   - it has at least 100 confirmations, so a reorg can't undo it;
   - its coinbase transaction is exactly the one built from that visitor's share;
   - that coinbase pays our address for the share's hour. The service derives that address from our words; it never takes it from the record.
4. **Each block is paid at most once.** The payout spends that block's reward, from that hour's address. It's reserved before it's broadcast: one atomic step claims the block and the exact coins, using a lock file on Node and one D1 transaction on Cloudflare. Then it's marked `sent`.

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

For `needs-review`, first look the txid up on a block explorer. If it never reached the chain, release the attempt with `ledger.void(blockHash)` on the store (`server/node/file-stores.js` or `server/cloudflare/d1-stores.js`). The retry builds the identical transaction, so the visitor is never paid twice.

## Security notes

- **Our wallet is a hot wallet** on either target. Every block reward lands in it, so move our 90% from its first address to cold storage after a win.
- **The xpub is a privacy secret.** It can't spend, but it reveals every address of the wallet.
- **Words shared by message** sit on that messaging service. The site warns visitors before it shares. It never stores the words itself; only the visitor's download, copy or share puts them anywhere.
- **The records are trusted.** Anyone who can write our share records could also read `OWNER_MNEMONIC`, so protect the server or the Cloudflare account.
- **The crypto libraries were reviewed.** The wallet and transaction code is Paul Miller's audited `@scure`/`@noble` libraries, pinned exactly and bundled into the library's `dist/`. The review is in [tau-crypto/AUDIT.md](tau-crypto/AUDIT.md). The site's framework packages (Next.js, React, OpenNext) are pinned exactly and have verified npm registry signatures.

## Development

Everything runs in Docker. The host only needs Docker.

```sh
tau-crypto/dev setup   # once: the library's images (the dev image is shared by server/)
server/dev setup       # the regtest bitcoind image; npm ci --ignore-scripts for server/ and server/site
server/dev test        # every server and site test (starts a fresh private regtest node)
server/dev site build  # the site with next build;  server/dev site cf-build: with OpenNext for Cloudflare
server/dev bundle      # the payout Worker as `wrangler deploy` would build it
```

The tests use a private **regtest** Bitcoin Core 32.1 node (no peers, no real network) and run Cloudflare's runtime (`workerd`) locally. They cover:
- the settings and the API;
- both storage adapters, against one contract;
- end to end on Node and on the Worker: the real miner mines to our address for the slot, bitcoind accepts the block, and once it's mature the visitor is paid exactly 10%, once, from that address, with our 90% back at our first address;
- the Worker's Cloudflare glue;
- the site in headless Chromium:
  - creating a wallet;
  - download, share, copy and restore;
  - the address rendered on the server;
  - consent, mining a block in the page, and seeing it paid.

The library's tests, build and dependency audit run with `tau-crypto/dev` (see its README).
