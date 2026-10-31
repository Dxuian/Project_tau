# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules for this project

- **Everything runs in Docker.** Never run node, npm, tsc, emcc, gcc or tests on the host. Use `./dev <cmd>` (it only calls `docker compose`); `./dev shell <cmd>` runs anything in the dev container (cwd `/src` = this folder).
- **No live mining or real pool connections from this machine.** Tests use `test/mock-pool.ts` on 127.0.0.1 only.
- **Consent-first library:** nothing connects or hashes until `miner.start()`. Don't add stealth features (obfuscation, evading blockers/monitoring).
- The package is `"private"` with no license field; it is not published.
- **`dist/` is committed** (it's what websites serve and Node runs). After changing `src/`, `bin/` or `native/`, rebuild (`./dev wasm` for C changes, then `./dev build`) and commit `dist/` with the change.
- **No platform code in the library.** Runtime pieces (opening a TCP socket, accepting a WebSocket upgrade) are parameters. The Cloudflare glue lives in `../server/cloudflare/worker.js`. `test/entries.test.ts` fails on `WebSocketPair`, `cloudflare:` or `cf-connecting-ip` anywhere in `src/` or `dist/`, and on Node built-ins or embedded WASM in the `wallet`, `payouts` and `bridge` entries, which must run on edge runtimes.

## Commands

```sh
./dev setup          # build images (dev: emsdk+Node+gcc+Chromium; ref-amd64: Debian GCC) + npm install
./dev vendor         # fetch pinned cpuminer-opt (b34565b, git clone into the cache volume) and copy it into native/vendor/
./dev wasm           # patch + compile native/out/cmo-{sse41,sse42,avx2}.wasm, regenerate src/wasm/variants/ and src/algos.generated.ts
./dev golden         # native reference vectors: test/golden/golden-{arm64,x86,x86-avx2}.json (~4 min, needs the verthash dataset in the cache volume)
./dev build          # dist/ (esbuild; worker inlined as a string; one lazy chunk per WASM variant)
./dev test           # all Node tests (node --test test/*.test.ts); includes the ~5 min golden test
./dev test:browser   # Playwright + Chromium (SwiftShader WebGPU) in the container
./dev bench --all    # per-algo fastest variant -> src/tune/variant-prefs.ts
./dev audit          # dependency review checks (AUDIT.md): lockfile, signatures, provenance, static scan
./dev shell node --test test/work.test.ts      # one test file
./dev shell npx tsc --noEmit -p .              # strict type check
```

Node 26 runs the `.ts` sources directly (type stripping): **erasable TypeScript only** (no enums, namespaces, parameter properties), `import type`, `.ts` extensions in relative imports.

## Architecture

- **C is the source of truth for hashing and for stratum job → work construction** (per-algo quirks live in cpuminer-opt's gates and `stratum_notify`). The shim (`native/shim/`) compiles cpuminer-opt's algo tree plus ported pieces of `cpu-miner.c`/`util.c` (`ported.c`) and exports the `cmo_*` API (`cmo.c`; struct layout shared with `src/wasm/api.ts` via `cmo.h`).
- `native/patches/patches.mjs` is the portability + bug-fix patch set, applied by `scripts/prepare-src.mjs` to a copy of the vendored tree in the cache volume (the vendored tree stays pristine). Each patch must match an exact number of times. Gate fields the shim calls through pointers have their `(void*)` casts stripped so signature mismatches fail at compile time (WASM traps on mismatched `call_indirect`).
- TypeScript runtime (`src/`): `env/detect.ts` (capabilities) → `tune/autotune.ts` (measures candidate backends in a real worker) → `pool/` (worker pool; the same `ScanLoop` runs in workers or inline) → `miner.ts` (stratum client + main-thread work instance + pool + GPU loop). Backends register in `src/backends/registry.ts`; WASM kernels get a compiled `WebAssembly.Module` posted from the main thread (`backends/setup.ts`), so the worker bundle never contains the embedded WASM.
- Stratum: `src/stratum/` (client + Node TCP/TLS and WebSocket transports). The bridge (`src/bridge/`):
  - `core.ts`: the allowlist, `poolTarget`, the interceptor contract and the in-order `LinePipe`;
  - `fetch.ts`: `createFetchBridge`, a web-standard `fetch(request)` handler, with the runtime's `connect` and `upgrade` passed in, so it tests in Node;
  - `node.ts`: `createBridge`, its own RFC 6455 server, or attached to an app's `node:http` server; the CLI's `bridge`.
  `BRIDGE_FEATURES` advertises what the server code (`../server/`) depends on.
- Wallet and payouts: `src/wallet/` (keys, payments, chain clients) and `src/payouts/`:
  - the header rebuild and `verifyBlock`;
  - `auditor.ts`, `createShareAuditor`, the bridge interceptor that records shares;
  - the `verifyPayout` engine and the store interfaces;
  - `service.ts`, `createPayoutService`, which wires the auditor and the engine to one owner.
  The library holds **mechanisms only**: no env vars, keys, defaults for money policy, or storage of its own; the server code passes them in. Exact-pinned `@scure`/`@noble` dependencies are bundled into `dist/` (shared chunk; `index.js` loads it lazily for `mineBTC`); any new runtime dependency needs the AUDIT.md treatment (`./dev audit`).
- Entries, by where they run (README): `tau-crypto` (mining: browsers, Node, workers), `/wallet` (anywhere), `/payouts` and `/bridge` (servers and edge runtimes), `/bridge/node` (Node). There are no `'use client'` / `'use server'` directives: apps put them in their own files.

## Verification design (read before changing hashing code)

- `test/golden.test.ts`: each WASM variant vs the native build that runs the **same code paths** (sse41/sse42 ↔ x86-64-v2, avx2 ↔ x86-64-v3 without AES). Different cpuminer-opt code paths may traverse the nonce space differently (e.g. byte-swapped counters), so never compare across paths by nonce.
- `test/anchors.test.ts`: solutions re-hashed by independent implementations (node:crypto, `test/reference/scrypt.ts`). Golden tests can't catch upstream bugs present in both builds; anchors can.
- The fixture is `cmo_fixture_data()` (C, shared by harness and tests). Older scanhash loops skip hashing unless `target[7] <= 0x10000000`, and some only report on `return true` (recorded as `legacy` solutions without a hash). quark/x11evo are compared via `cmo_direct_hash` (`native/shim/direct.c`).
- Upstream bugs fixed by patches (B-*): hex `simd512_ctx` length in bits, sha256dt 4x32 uninitialised padding, `v128_bswap32_intrlv80_4x32` using s2 for s4 (sha256q and other SSE 4-way users), sha256 8-way early-exit Maj. Upstream's ARM builds also compute wrong sha256t/scryptn2; the arm64 golden file is a second opinion only.

## Gotchas

- `data[i]` = BE32 of header bytes `4i..4i+3`; the nonce is `data[19]`; submit nonce/ntime are `le32enc` of those words (block 1's nonce 0x9962e301 is `data[19] = 0x01e36299`).
- The target is pool-standard `0xFFFF·2^208/diff` (upstream uses 2^224, slightly too easy).
- verthash needs `verthash.dat` (1,283,457,024 bytes, SHA-256 `48aa21d7…`) loaded into each instance's memory; Node only.
- `bmw` has no registration upstream; `yespower-b2b` needs params.
- `scripts/gen-sha256-js.mjs` generates the unrolled part of `src/backends/js.ts`.
