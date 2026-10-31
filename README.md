# Project_tau

Browser Bitcoin mining where visitors keep a share of the blocks they find.

- Visitors mine in their browser through your **payout bridge**, which logs them in to the pool with **your** address. Every block pays you.
- If a visitor's miner finds a block, they get **10%** of what you received. The percentage is a setting, and you pay the network fee.

> **Consent and odds.** Mining runs the visitor's CPU. Only start it after they agree, and tell them about the split. Also tell them the odds: one browser at ~10 MH/s finds a Bitcoin block about once in 2 billion years, so this is a lottery ticket, not income.

## Library and server code

The repo has two parts:

| folder | what | rule |
|---|---|---|
| [`tau-crypto/`](tau-crypto/README.md) | **the crypto library**: mining, wallets and new addresses, payments, payout proofs, the share auditor, `createPayoutService`, and the bridges | mechanisms only; every value is a parameter; no keys, storage or platform code of its own |
| `server/` | **server-side code**, not part of the library: your settings, the payout HTTP API, storage, and the Node and Cloudflare entry points | your policy, keys, storage and deployment |

Inside `server/`:

| file | what |
|---|---|
| `server/config.js` | your settings from `TAU_*` variables (`loadConfig`), and the chain client they choose |
| `server/api.js` | `createPayoutApi`: the library's `createPayoutService` with your settings, served as a web-standard `fetch(request)` handler for `POST /payout` and `GET /health` |
| `server/node/` | the Node target: `server.js` (entry point), `index.js` (the HTTP server and the library's Node bridge on one port), `file-stores.js` (records as files) |
| `server/cloudflare/` | the Cloudflare target: `worker.js`, `d1-stores.js` (records in D1), `schema.sql`, `wrangler.toml` |

The Cloudflare-specific part lives in `server/cloudflare/worker.js` and is small. It hands the library's runtime-neutral bridge (`createFetchBridge`) three things: Workers' TCP `connect()`, a `WebSocketPair` for the upgrade, and the `cf-connecting-ip` header.

### A Next.js or Cloudflare Pages app later

The library's entries are split by where they run (see the [table](tau-crypto/README.md#entries-and-where-each-runs)):
- **Pages and client components (`'use client'`)** import `tau-crypto` (the miner) and `tau-crypto/wallet` (wallets, new addresses). The visitor's words stay in their browser.
- **Server code** imports `tau-crypto/payouts` and `tau-crypto/bridge`, together with `server/config.js`, `server/api.js` and a store. That covers `'use server'` actions, route handlers, Pages Functions and Workers.
- **`server/api.js` is already web-standard.** Its `fetch(request)` can be a Next.js route handler or a Pages Function as it is.
- **The WebSocket bridge needs a runtime that accepts upgrades and opens TCP sockets.** A Worker or Pages Function does, with the same glue as `worker.js`.

## Settings

One set of settings works for both targets. On Node they are environment variables; on Cloudflare they are the `[vars]` in `server/cloudflare/wrangler.toml`.

| variable | default | meaning |
|---|---|---|
| `TAU_OWNER_ADDRESS` | required | your address: the pool pays it, and visitors are logged in as it |
| `TAU_CLIENT_SHARE_PERCENT` | `10` | the finder's share of your block reward, whole percent |
| `TAU_POOL` | `stratum+tcp://solo.ckpool.org:3333` | the only pool the bridge connects to |
| `TAU_NETWORK` | `mainnet` | or `testnet`, `regtest` |
| `TAU_CHAIN`, `TAU_CHAIN_URL` | `esplora`, `https://mempool.space/api` | or `bitcoin-core` with `TAU_CHAIN_USER` / `TAU_CHAIN_PASS` for your own node |
| `TAU_STORAGE` | `file` (Node), `d1` (Cloudflare) | `TAU_STORAGE_DIR` (default `payout-ledger`), `TAU_D1_BINDING` (default `DB`) |
| `TAU_ORIGINS` | none | the web pages allowed to connect and call `/payout`, comma-separated |
| `TAU_MIN_CONFIRMATIONS`, `TAU_MAX_FEE_RATE` | `100`, `200` | the minimum confirmations before paying (at least 100); the most it will pay in fees, in sat/vB |
| `TAU_LISTEN`, `TAU_HOST`, `TAU_SWEEP_INTERVAL_MS` | `8080`, all interfaces, `0` | Node only. The sweep pays every visitor with a mature block on a timer; `0` means only when asked. |
| `OWNER_MNEMONIC` | none | the owner wallet's words; without them shares are recorded but nothing is paid |

Make the owner wallet a dedicated one with `createWallet()`, not your personal seed. The service refuses to start if `OWNER_MNEMONIC` doesn't belong to `TAU_OWNER_ADDRESS`.

## Pick a target

### Node: `server/node/server.js` on your server

```sh
TAU_OWNER_ADDRESS=bc1q… OWNER_MNEMONIC="word1 … word12" TAU_ORIGINS=https://yoursite.com node server/node/server.js
```

One port serves:
- the bridge (WebSocket);
- `POST /payout {"address": "…"}`;
- `GET /health`.

The bridge doesn't do TLS itself: for `wss://`, put it behind nginx or Caddy.

### Cloudflare: `server/cloudflare/worker.js`, no server

These steps run under your own Cloudflare account, from the repo root:

```sh
npx wrangler d1 create tau-payouts -c server/cloudflare/wrangler.toml   # put the id into wrangler.toml
# edit server/cloudflare/wrangler.toml: TAU_OWNER_ADDRESS, TAU_ORIGINS
npx wrangler secret put OWNER_MNEMONIC -c server/cloudflare/wrangler.toml
npx wrangler deploy -c server/cloudflare/wrangler.toml
```

It serves the same three things from the Worker. Records go to D1, and the tables are created on first use. An optional cron trigger in `wrangler.toml` runs the payout sweep.

Things to check on Cloudflare:
- Workers can't open connections to private or localhost addresses, so the pool must be public.
- The free plan's CPU limits may cut long connections. The miner reconnects by itself, but the paid plan is the safer choice.
- The pool sees every visitor connecting from Cloudflare's addresses and may limit that.

### A visitor's page

Serve the `tau-crypto/dist/` folder:

```html
<script type="module">
  import { mineBTC } from './tau-crypto/dist/index.js';
  import { createWallet, newAddress } from './tau-crypto/dist/wallet.js';
  const wallet = createWallet();               // show wallet.mnemonic once; never store or send it
  startButton.onclick = async () => {
    const miner = await mineBTC(wallet.address, 'wss://pool.yoursite.com');   // your bridge (Node or Worker)
    miner.on('hashrate', (h) => console.log(h.hps));
  };
  // another address from the same words: newAddress(wallet) is index 1, newAddress(thatResult) index 2, …
  // later: fetch('https://pool.yoursite.com/payout', { method: 'POST', body: JSON.stringify({ address: wallet.address }) })
</script>
```

About `newAddress(wallet)`:
- **It gives the wallet's next receive address** (BIP84 `m/84'/0'/0'/0/1`, then `/2`, …) and returns the wallet at that address. Pass that result to the next call to get the address after it. The library remembers nothing: the same wallet gives the same address, and `newAddress(wallet, { index: 7 })` gives address 7.
- **It needs the words.** Call it while the page still has the wallet object, or after the visitor types the words back in as `{ mnemonic, network, index }`. Keep `index` (not the words) to carry on from there.
- **Gap limit.** Sparrow and other BIP84 wallets restored from the words find what every address received, but they stop looking after 20 unused addresses in a row. Only hand out a new address once the earlier ones have been used, or raise the gap limit when restoring.
- **`payout` only spends from the first address** (index 0). This is why `TAU_OWNER_ADDRESS` must be the owner wallet's first address, and the service checks that. Visitors spend what reaches their other addresses with Sparrow or any other BIP84 wallet.

## How a win is verified

Nothing a visitor says is trusted.

1. **The bridge sees everything.** Every visitor's miner talks to the pool through your bridge. The bridge sees each job the pool sends and each share the miner submits, on a connection tied to the visitor address it logged in with. One address per connection.
2. **Each share is recorded before the pool sees it.** The library's share auditor rebuilds the share's block header itself and hashes it, so proof of work can't be faked. It stores the raw share in a file or in D1, together with whether it is a block, and only then forwards the share to the pool.
3. **`verifyPayout` confirms the block on the blockchain.** It rebuilds each recorded block from the raw fields (it never trusts a stored hash) and pays only if all of these hold:
   - the block is in the best chain;
   - it has at least 100 confirmations, so a reorg can't undo it;
   - its coinbase transaction is exactly the one built from that visitor's share;
   - that coinbase pays your address.
4. **Each block is paid at most once.** The payment is reserved before it's broadcast. A single atomic step claims the block and the exact coins it spends, using a lock file on Node and one D1 transaction on Cloudflare. It's marked `sent` afterwards.

What it refuses, and why:

| attempt | why it fails |
|---|---|
| claiming a block they didn't find | the block must be on-chain, and its header and coinbase must match the visitor's own recorded share |
| getting someone else's payout | a win belongs to the connection that submitted the share; `verifyPayout(a)` only pays `a`, and only for `a`'s blocks |
| mining to their own address through your site | the bridge replaces their pool login with your address |
| getting paid twice | one reservation per block and per coin, even across processes or Workers; a crashed attempt stays `needs-review` |
| protocol tricks | only five stratum messages are allowed; JSON is re-serialized after checking (no duplicate-key tricks); hex fields and sizes are validated; version rolling is refused; submits are rate-limited; extranonce changes are tracked per job |

`verifyPayout` reports one status per block:

| status | meaning |
|---|---|
| `paid` | the payout was sent now |
| `already-paid` | the block was paid before |
| `immature` | under 100 confirmations; ask again later |
| `not-in-chain` | not a block in the best chain (stale, orphaned or unknown) |
| `not-ours` | the coinbase on the chain is not the one from the share, or doesn't pay you |
| `not-paid-yet` | verified, but the payment couldn't be built yet, e.g. no mature funds, or fees above the cap |
| `needs-review` | a payment was started but not confirmed as sent |

For `needs-review`, first look the txid up on a block explorer. If it never reached the chain, release the attempt to allow a retry: run `ledger.void(blockHash)` on the store (`server/node/file-stores.js` or `server/cloudflare/d1-stores.js`). The retry builds the identical transaction, so even if the first attempt did get through, the visitor is never paid twice.

## Security notes

- **The owner wallet is a hot wallet** on either target, whether its words are an environment variable or a Worker secret. Every block reward lands in it, so move your 90% to cold storage (Sparrow) after a win.
- **The records are trusted.** Anyone who can write your share records could also read `OWNER_MNEMONIC`, so protect the server or Cloudflare account.
- **The libraries were reviewed.** The wallet and transaction code is Paul Miller's audited `@scure`/`@noble` libraries, pinned exactly and bundled into the library's `dist/`. The review is in [tau-crypto/AUDIT.md](tau-crypto/AUDIT.md). `selectUTXO`, which isn't audited, is not used; coin selection is our own largest-first pick.

## Development

Everything runs in Docker:
- the `app` container reuses the `tau-crypto-dev:local` image;
- tests start a private **regtest** Bitcoin Core 32.1 node, with no peers and no real network;
- the Cloudflare tests run the real Workers runtime (`workerd`, through Miniflare) locally.

```sh
tau-crypto/dev setup   # once: builds the dev image
./dev setup            # regtest bitcoind image, npm ci --ignore-scripts
./dev test             # all tests (starts a fresh regtest node)
./dev bundle           # the Worker as `wrangler deploy` would build it
```

The tests cover:
- loading and validating the settings, and the payout API through `fetch(request)`;
- both storage adapters against one contract, including concurrent reservations;
- end to end on both targets. The real miner mines through the bridge to a regtest pool, on `server/node` and on `server/cloudflare/worker.js` in workerd with D1. bitcoind accepts the block; once it is mature, `POST /payout` pays exactly 10%, once, and an orphaned block is never paid;
- the Worker's Cloudflare glue in workerd: origin and target refusals, and 502 for an unreachable pool;
- a page in headless Chromium mining through the bridge and calling `/payout` across origins.

The library's own tests, build and dependency audit run with `tau-crypto/dev`.
