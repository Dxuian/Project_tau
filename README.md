# Project_tau

Browser Bitcoin mining with wallet creation, found-block verification and payouts.

- `cpuminer-opt-js/` is the miner library: cpuminer-opt compiled to WebAssembly, for Node and browsers. See its README.
- `btc.js` holds the site's API on top of it.
- `btc.browser.js` is the same file bundled with its dependencies, for web pages.

## The model

- Visitors mine in their browser through your **payout bridge**, which logs them in to the pool with **your** address. Every block they find pays you.
- If a visitor's miner finds a block, `verifyPayout(theirAddress)` sends them **10%** of what you received (`CLIENT_SHARE_PERCENT`). You pay the network fee.

> **Consent and odds.** Mining runs the visitor's CPU. Only start it after they agree, and tell them about the split. Also tell them the odds: one browser at ~10 MH/s finds a Bitcoin block about once in 2 billion years, so this is a lottery ticket, not income.

## API (`btc.js`)

| function | where | what |
|---|---|---|
| `createWallet({ words = 12, network = 'mainnet' })` | browser/Node | `{ mnemonic, address, path }`: 12 random words and their first native SegWit (`bc1q…`) address, BIP84, the same as Sparrow derives. Show the words once and never send them to a server. |
| `walletFromMnemonic(words, { network })` | browser/Node | the address of an existing wallet (checks the checksum) |
| `isValidAddress(address, network)` | browser/Node | checks that an address is valid on that network |
| `mineBTC(address, url, options)` | browser/Node | starts mining for `address` and returns the running miner (`stop()`, `stats()`, events). `url` is your payout bridge (`wss://…`), or a pool (`stratum+tcp://…`, Node only, plain solo mining with no split). |
| `startPayoutBridge({ listen, pool, ownerAddress, ledgerDir, origins })` | server | the bridge browsers mine through; records every share |
| `verifyPayout(address, options)` | server | pays `address` 10% of each block it provably found, at most once per block |
| `payout(to, amountSats, options)` | server | sends BTC from the owner wallet |
| `esplora(url)`, `bitcoinCore({ url, user, pass })` | server | blockchain access for the two functions above (default: mempool.space) |

### A visitor's page

Serve `btc.browser.js` together with the `cpuminer-opt-js/dist/` folder (same layout as this repo):

```html
<script type="module">
  import { createWallet, mineBTC } from './btc.browser.js';
  const wallet = createWallet();             // show wallet.mnemonic once; keep only wallet.address
  startButton.onclick = async () => {
    const miner = await mineBTC(wallet.address, 'wss://pool.yoursite.com');
    miner.on('hashrate', (h) => console.log(h.hps));
  };
</script>
```

### Your server (Node 22.3+)

```js
import { startPayoutBridge, verifyPayout } from './btc.js';

// The owner wallet: make a dedicated one with createWallet(), not your personal seed.
// OWNER_MNEMONIC holds its words. Its address is what the pool pays.
await startPayoutBridge({
  listen: 8080,
  pool: 'stratum+tcp://solo.ckpool.org:3333',
  ownerAddress: 'bc1q…owner…',
  origins: ['https://yoursite.com'],
});

// e.g. from an HTTP endpoint the visitor calls; it is safe to expose, because it
// only ever pays `address`, and only for that address's own blocks:
const results = await verifyPayout(address);   // [{ blockHash, status, payoutSats, txid, ... }]
```

`OWNER_MNEMONIC` and `PAYOUT_LEDGER` (default `./payout-ledger`) are read from the environment. The bridge doesn't do TLS itself: for `wss://`, put it behind nginx or Caddy.

## How a win is verified

Nothing a visitor says is trusted.

1. **The bridge sees everything.** Every visitor's miner talks to the pool through your bridge. The bridge sees each job the pool sends and each share the miner submits, on a connection tied to the visitor address it logged in with. One address per connection.
2. **Each share is checked when it arrives.** The bridge rebuilds the share's block header itself and hashes it, so proof of work can't be faked. It records the raw share in `shares.jsonl`, together with whether it is a block.
3. **`verifyPayout` confirms the block on the blockchain.** It rebuilds each recorded block from the raw fields (it never trusts a stored hash) and pays only if all of these hold:
   - the block is in the best chain;
   - it has at least 100 confirmations, so a reorg can't undo it;
   - its coinbase transaction is exactly the one built from that visitor's share;
   - that coinbase pays your address.
4. **Each block is paid at most once.** The payment is written to `payouts.jsonl` as `pending`, with its txid, before it's broadcast, and as `sent` after. A lock file stops two runs at once.

What it refuses, and why:

| attempt | why it fails |
|---|---|
| claiming a block they didn't find | the block must be on-chain, and its header and coinbase must match the visitor's own recorded share |
| getting someone else's payout | a win belongs to the connection that submitted the share; `verifyPayout(a)` only pays `a`, and only for `a`'s blocks |
| mining to their own address through your site | the bridge replaces their pool login with your address |
| getting paid twice | the ledger and lock allow one payout per block; a crashed attempt stays `needs-review` |
| protocol tricks | only five stratum messages are allowed; JSON is re-serialized after checking (no duplicate-key tricks); hex fields and sizes are validated; version rolling is refused; submits are rate-limited; extranonce changes are tracked per job |

`verifyPayout` reports one status per block:

| status | meaning |
|---|---|
| `paid` | the payout was sent now |
| `already-paid` | the block was paid before |
| `immature` | under 100 confirmations; ask again later |
| `not-in-chain` | not a block in the best chain (stale, orphaned or unknown) |
| `not-ours` | the coinbase on the chain is not the one from the share, or doesn't pay you |
| `not-paid-yet` | verified, but the payment couldn't be built yet, e.g. no mature funds, or fees above `maxFeeRate` |
| `needs-review` | a payment was started but not confirmed as sent |

For `needs-review`, first look the txid up on a block explorer. If it never reached the chain, append `{"type":"payout","status":"void","blockHash":"…"}` to `payouts.jsonl` to allow a retry. The retry builds the identical transaction, so even if the first attempt did get through, the visitor is never paid twice.

## Security notes

- **The owner wallet is a hot wallet.** `verifyPayout` signs automatically, so the server holds the owner's words and every block reward lands in that wallet. Use a dedicated wallet, and move your 90% to cold storage (Sparrow) after a win.
- **The ledger is trusted.** Anyone who can write to `payout-ledger/` could also read `OWNER_MNEMONIC`, so protect the server.
- **The libraries were reviewed.** The wallet and transaction code is Paul Miller's audited `@scure`/`@noble` libraries, pinned exactly. The review is in [AUDIT.md](AUDIT.md). `selectUTXO`, which isn't audited, is not used; coin selection is our own, a simple largest-first pick.

## Development

Everything runs in Docker:
- the `app` container reuses the `cpuminer-opt-js-dev:local` image;
- tests also start a private **regtest** Bitcoin Core 32.1 node, with no peers and no real network.

```sh
cpuminer-opt-js/dev setup   # once: builds the dev image
./dev setup                 # regtest bitcoind image, npm ci --ignore-scripts
./dev test                  # all tests (starts a fresh regtest node)
./dev build                 # rebuild btc.browser.js after changing btc.js (commit it)
./dev audit                 # re-run the dependency checks from AUDIT.md
```

The tests cover:
- the BIP39, BIP32 and BIP84 test vectors;
- the auditor, against Bitcoin block 1 and attack cases;
- payouts and verification, against a mock chain;
- an end-to-end run: the real miner, on Node and in headless Chromium, mines through the payout bridge to a regtest pool. bitcoind accepts the block, and once it is mature the visitor is paid exactly 10%, once. An orphaned block is never paid.
