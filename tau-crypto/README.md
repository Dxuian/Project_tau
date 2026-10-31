# tau-crypto

[cpuminer-opt](https://github.com/JayDDee/cpuminer-opt) v26.1, compiled to WebAssembly,
with a self-contained JavaScript runtime that mines in **Node.js, browsers and workers**.

- **All 91 cpuminer-opt algorithms**, from cpuminer-opt's own C code: sha256d, scrypt,
  x11..x25x, lyra2, yespower, argon2d, verthash, m7m and the rest (90 run; `bmw` was
  never registered upstream).
- **Auto-detects the best way to hash on the machine it's running on.** It checks what
  the environment supports (WASM SIMD, workers, WebGPU, Node's native crypto, cores,
  memory), then *measures* each candidate backend and picks the fastest plus a thread
  count that fits in memory.
- **Self-contained**: no native addons, nothing to install, no separate `.wasm` or worker
  files to host. The WASM is embedded (and only the variants you use are loaded); the
  wallet code's dependencies (Paul Miller's audited `@scure`/`@noble` libraries, exact
  versions reviewed in [AUDIT.md](AUDIT.md)) are bundled into `dist/`.
- **Wallets, payout verification and the bridge** as separate entries (below), for sites
  that share block rewards with the visitors who mine.

> **Nothing mines until you call `start()`.** Mining keeps the CPU (and GPU) busy and
> uses power. Only mine on devices you own or whose owner has explicitly agreed —
> running a miner in other people's browsers without consent is cryptojacking.

## How it works

```
JS app ──createMiner()──▶ autotune ──▶ worker pool (one WASM instance per worker) ─┐
         stratum client ◀──── shares ◀──── work instance (cpuminer-opt's job/work code) ◀┘
         └─ TCP/TLS (Node) or WebSocket → bridge → TCP (browsers)
```

- cpuminer-opt's C sources (hashing **and** stratum job → work construction, with all
  its per-algorithm quirks) are compiled with Emscripten into three variants:
  `sse41`, `sse42` and `avx2` (cpuminer-opt's SSE/AVX2 code, translated to WASM SIMD128).
  A small, documented patch set makes the code portable to wasm32 — see
  `native/patches/patches.mjs` (every patch says why).
- A hand-tuned `wasm_simd128` sha256d/t/q kernel (`native/kernels/sha256_fast.c`,
  4- and 8-lane) adds an early exit on top of upstream's structure.
- Hand-written `js` and `node-crypto` sha256 kernels cover environments without
  WASM SIMD, and a WebGPU kernel covers GPUs (sha256d/t/q).
- Any solution from a hand-written kernel is re-checked with cpuminer-opt's own code
  before it's submitted.

### Backends

| backend | what | algorithms |
|---|---|---|
| `wasm-avx2`, `wasm-sse42`, `wasm-sse41` | compiled cpuminer-opt | all |
| `wasm-sha256-x8`, `wasm-sha256-x4` | hand-tuned WASM SIMD kernel | sha256d, sha256t, sha256q |
| `webgpu` | WGSL compute shader | sha256d, sha256t, sha256q |
| `node-crypto` | Node's OpenSSL (CPU SHA extensions), per hash | sha256 family, Node |
| `js` | pure JS (for pages whose CSP blocks WebAssembly) | sha256 family |

CPU features such as AVX2 or SHA-NI aren't visible from WebAssembly, so the choice is
made by measurement, not by flags.

## Use it

`dist/` in this repo is the built library, ready to use: a website serves it as is and
Node runs it directly (`node dist/cli.js`, Node 22.3+), so users never build anything.

Building is only needed after changing the code. Everything runs in Docker (nothing to
install on the host but Docker); commit the rebuilt `dist/` along with the change:

```sh
./dev setup        # build the images, install dev dependencies (once)
./dev vendor       # copy the pinned cpuminer-opt sources from ../cpuminer-opt
./dev wasm         # compile the WASM variants
./dev build        # build dist/
./dev test         # Node test suite (incl. the golden tests)
./dev test:browser # headless Chromium tests
./dev golden       # regenerate the native reference vectors
```

### Node

```js
import { createMiner, detect, benchmark } from 'tau-crypto';

console.log(await detect());
const r = await benchmark({ algo: 'sha256d', seconds: 5 });   // measures every backend

const miner = await createMiner({
  algo: 'sha256d',
  url: 'stratum+tcp://solo.ckpool.org:3333',
  user: 'bc1q…your address…',
  pass: 'x',
  // threads: 'auto', backend: 'auto', gpu: true, throttle: 0   (defaults)
});
miner.on('share', (s) => console.log(s.accepted ? 'accepted' : `rejected: ${s.reason}`));
miner.on('hashrate', (h) => console.log(h.hps));
await miner.start();
// later: miner.pause(), miner.resume(), miner.setThrottle(0.5), miner.stop()
```

CLI (cpuminer-style options):

```sh
tau-crypto --benchmark -a sha256d
tau-crypto -a sha256d -o stratum+tcp://solo.ckpool.org:3333 -u <address> -p x
tau-crypto --list-algos
```

### Browser

Browsers can't open TCP connections, so pool traffic goes through a bridge you run:

```sh
tau-crypto bridge --listen 8080 --allow solo.ckpool.org:3333 [--origin https://your.site]
```

```js
import { createMiner } from 'tau-crypto';
const miner = await createMiner({
  algo: 'sha256d',
  url: 'stratum+tcp://solo.ckpool.org:3333',
  bridge: 'ws://localhost:8080',
  user: 'bc1q…',
});
startButton.onclick = () => miner.start();
```

The bridge only connects to allowlisted `host:port` targets, so it can't be used as an
open proxy. In browsers the miner pauses while the page is hidden (`pauseWhenHidden`).
`examples/browser/index.html` is a demo page (serve the project folder and open it).
`mineBTC(address, url)` is a shortcut: sha256d for `address`, through a bridge (`ws://`,
`wss://`) or straight to a pool (`stratum+tcp://`, Node).

## Wallets, payouts and the bridge

Mechanisms only: every value (who gets paid, what share, where records live) is a
parameter, and nothing stores keys or state of its own. `../btc.js` and `../app/` show one
application built on them.

| entry | what |
|---|---|
| `tau-crypto/wallet` | `createWallet()` (BIP39 words + BIP84 `bc1q…` address, offline), `newAddress(wallet, { index? })` (the wallet's next receive address, `m/84'/0'/0'/0/<index>`, returned as the wallet at that address), `walletFromMnemonic`, `isValidAddress`, `addressScript`; `payout(to, sats, { mnemonic, chain })` / `buildPayment` (spends from the first address; largest-first coin selection, upper-bound fee, change, signing); chain clients `esplora(url)` (mempool.space) and `bitcoinCore({ url, user, pass })` |
| `tau-crypto/payouts` | `rebuildBlockHeader(share)` (header from stratum fields, block or not), `verifyBlock(block, { chain, payToScript })` (best chain, confirmations, coinbase, payee), and the engine `verifyPayout(address, { shares, ledger, chain, ownerMnemonic, sharePercent })`: pays a visitor `sharePercent` of each block they provably found, once; `payoutAll`; the `ShareStore` / `PayoutLedger` interfaces and `memoryStores()` |
| `tau-crypto/bridge` | `createBridge` (Node; or attached to your own `node:http` server with `server`), `createWorkerBridge` (Cloudflare Workers: pass `connect` from `cloudflare:sockets`), and `createShareAuditor({ poolUser, onShare })`, the interceptor that logs every connection in to the pool as `poolUser` and records each share before forwarding it |

Bridge interceptors (`intercept`) see, rewrite or drop every stratum line, may be async
(lines stay in order per direction) and can reply to the client; `BRIDGE_FEATURES` lists
what a build supports. The `PayoutLedger.reserve()` contract is what makes "once" hold
across processes: it must atomically claim the block and the coins a payment spends.

## Verification

- **Golden tests**: every algorithm, in every WASM variant, must reproduce the output of
  the same patched C code built natively for x86-64 (upstream's main platform, GCC,
  under Docker's amd64 emulation). Each variant is compared with the native build that
  runs the same code paths (`x86-64-v2` for sse41/sse42, `x86-64-v3` for avx2). This
  includes verthash with the real 1.28 GB dataset.
- The x86 reference itself was checked against independent implementations wherever one
  exists: `node:crypto` (sha256d, sha256t, sha256q, blake2s, scrypt N=1024) and a
  separate JS scrypt for scryptn2 (N=2^20, which OpenSSL refuses).
- Block 1 of Bitcoin, sent as a stratum job through a local mock pool, must come back as
  the exact `mining.submit` cpuminer-opt would send.

Upstream bugs found and fixed in the process (all in `native/patches/patches.mjs`):

- `v128_bswap32_intrlv80_4x32` filled header words 16–19 from the wrong register, so
  upstream's SSE/NEON 4-way builds hash the wrong header for sha256q (confirmed against
  node:crypto) and potentially the other users of that helper (blake-4way, blake2s,
  blakecoin, myr-gr, lyra2h/rev2/rev3, x16r/x16rv2 4-way);
- hex hashed 8× its input (`simd512_ctx` given bits instead of bytes), reading stack
  garbage — its results were nondeterministic (found with valgrind);
- sha256dt's 4-way path hashed an uninitialised padding word;
- the 8-way sha256 early exit computed wrong output words; a generic `bswap_64` was
  wrong; and several function-pointer signature mismatches (which trap in WASM).

Separately, upstream's own ARM builds produce wrong sha256t and scryptn2 hashes
(confirmed against independent references); this port follows the x86 paths.

Test suite: 468 Node tests (278 of them golden: 92 cases × 3 variants + reference checks)
and 18 headless-Chromium tests, including mining Bitcoin block 1 from a browser page
through the bridge to a mock pool, and the WebGPU kernel on SwiftShader.

## Performance (one machine, for orientation)

Measured in the dev container on an Apple M4 Pro (14 vCPUs), Node 26 / V8:

| sha256d | per thread |
|---|---|
| `wasm-sha256-x8` (hand-tuned) | 5.38 MH/s |
| `wasm-avx2` (upstream 8-way) | 5.24 MH/s |
| `wasm-sse41` (upstream 4-way) | 4.65 MH/s |
| `js` | 3.75 MH/s |
| `node-crypto` | 0.75 MH/s |

All 14 threads: 56.5 MH/s. `./dev bench --all` measures every algorithm in every
variant; AVX2-emulation wins big for some (blake2s 7.5×, blake2b 3.3×, lbry 2.5×) and
loses for others (scrypt), which is why the choice is measured, not assumed. Real GPUs
in a browser should be far faster than SwiftShader (38 MH/s in software).

## Limitations

- WebGPU kernels exist for the sha256 family only; other algorithms run on the CPU.
- verthash needs a 1.28 GB dataset per worker and runs in Node only.
- `yespower-b2b` needs parameters (`params: { n, r, key }`); `bmw` doesn't exist upstream.
- Stratum only (no getwork/GBT solo RPC).
- The library is private and unlicensed for now; the vendored cpuminer-opt code keeps
  its own license (`native/vendor/cpuminer-opt/COPYING`).
