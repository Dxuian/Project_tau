# Dependency audit: Bitcoin wallet libraries

Date: 2026-10-31. Scope: the runtime dependency tree of this project (dev dependencies esbuild and
playwright-core are out of scope). Everything was run inside the `cpuminer-opt-js-dev:local`
container (Node 26.13.0, npm 11.20.0). Re-run the automatable parts with `./dev audit`
(`scripts/audit.mjs`).

## Bottom line

**Nothing malicious or suspicious was found.**
- **Same as source:** the 7 installed packages are byte-identical to fresh builds of the
  maintainer-signed release commits.
- **Publishing:** they were published by GitHub Actions trusted publishing with valid SLSA
  provenance, and they have no install scripts.
- **No dangerous runtime paths:** the modules the project imports reach no network, `eval`,
  dynamic-import, filesystem or `process` code.
- **Entropy:** the only entropy source is `crypto.getRandomValues`.
- **Behaviour matches the specs:** the code paths the project uses match BIP39, BIP32, BIP84,
  BIP143, BIP173/350 and RFC 6979. This was confirmed by reading the code and by 441
  known-answer and differential tests against reference vectors and OpenSSL.

The main caveat is audit coverage, not code: the installed 2.4.x lines are newer than every
independently audited version with a published report (see Published audits).

## Versions and integrity

| Package | Version | Lockfile integrity (sha512) |
|---|---|---|
| @scure/bip39 | 2.4.0 | `sha512-82dxFbZUYboyOf0AXiydsQrFQ5Q4h9mX+O2UkE91ROYmsc0BKMGZLwDmy96Jpa2+vrtoxomjUhy1RPIgH/r2nA==` |
| @scure/bip32 | 2.4.0 | `sha512-i3DS0CptAocyvqE4n3SUkpzeQK4vJMFwWLofTwRiiKo2aWojBOfyMCgfKw9HVpO6fSY5AK86sHS/Uzn8kK9Few==` |
| @scure/btc-signer | 2.4.1 | `sha512-ch6h66o9nPhEoe/KciMMUJeH2MBPB8UAJI1if35Fxl6885lKTsc9YoCRqTW0/RjI0Vv9GSg1tmKtHHODyAw81g==` |
| @noble/hashes | 2.4.0 | `sha512-X5XaVWZIBCT7HHZGm5I7ZQXDwLG+bGXuSrMQAW+7Zvl87h1kmc1ZB1VSRJcpUfoUrGQp4Fkoxm5kZ+Ms+aW+eA==` |
| @noble/curves | 2.4.0 | `sha512-P4/62zrgfH33CneE3Dn4WhJVA22YUU0eR51wKIan4NVRvwsA0YnPTwWGpNbpuacSujmSFLvyzpyuR30+fbq2Ew==` |
| @scure/base | 2.4.0 | `sha512-thZ1TuJwFwBblOhgsjDKvvGirBxNp+wSvY/DR6tJBJOTDhdAAcHJ8Vbr2eFnqaxeca4+t0i9KBf+uHYGWwZORg==` |
| micro-packed | 0.11.1 | `sha512-agQGBnBCw8OoKQZMUxcaQPaOowdfxyEmBsq4CNAXAXCyB8KxlRG0lTl5GADJIsMEDaFb0trhXBHKYsjTWa5kuw==` |

package.json pins @scure/bip39, @scure/bip32, @scure/btc-signer and @noble/hashes exactly. All
seven are the current `latest` dist-tag; no newer versions exist.

## Method

1. Lockfile/registry/installed-file comparison, then `npm audit signatures`.
2. Decoded the SLSA provenance statements (verified by npm) for repo, tag, commit and workflow.
3. Cloned each repo at its tag and checked HEAD against the provenance commit, ran git fsck and
   verified the PGP signatures on the commits and tags. Then rebuilt the way the release
   workflow does (`npm ci --ignore-scripts && npm run build`, then `npm pack`) and diffed
   the result against `node_modules`.
4. Static scan: a regex scan of every installed file (`scripts/audit.mjs`), plus a one-off
   semantic pass with the TypeScript 6.0.3 compiler API:
   - free-global inventory and global/prototype writes;
   - AST classification of non-ASCII characters and long blobs;
   - the module graph reachable from the project's imports.
5. Read the code paths `btc.js` uses, then ran known-answer tests (KATs) from upstream spec
   repos (not the libraries' own tests) and differential tests against OpenSSL (`node:crypto`).
   Tripwires on network, timer, eval and RNG globals stayed armed for the whole run.
6. Collected README audit claims and checked the links that are on github.com.

Network note: github.com was reached through a TLS-inspecting network proxy, with TLS
verification kept on. Source integrity does not rely on that channel. It is anchored by the commit
SHAs in the sigstore-signed provenance, git object verification, PGP signatures and
byte-identical rebuilds. cure53.de URLs were not fetched.

## 1. Tree and integrity

- **Lockfile:** the non-dev entries in `package-lock.json` are exactly the 7 packages above.
  Each is resolved from `registry.npmjs.org` with sha512 integrity, with no
  `hasInstallScript`, `bin`, optional, peer or link flags and no nested copies (`npm ls --omit=dev`
  dedupes everything).
- **Registry:** each package's `dist.integrity` equals the lockfile value.
- **Installed files:** the files in `node_modules/<pkg>` are byte-identical to the registry
  tarball (`diff -r`; the tarball sha512 matches the lockfile).
- **Maintainer and publisher:** the only maintainer is `paulmillr`. `_npmUser` is "GitHub
  Actions" (trusted publisher) with `approver: paulmillr`, i.e. staged publishing.
- **Scripts:** there are no lifecycle scripts. The `scripts` blocks contain only
  build/test/benchmark entries.

`npm audit signatures` (in /repo):

```
audited 10 packages in 14s

10 packages have verified registry signatures

10 packages have verified attestations
```

The 10 are the 7 above plus esbuild 0.28.2, @esbuild/linux-arm64 0.28.2 and playwright-core 1.64.1
(dev). `--json` reports `invalid: []`, `missing: []`. Negative test: `npm audit signatures` still
passes when the lockfile integrity or the files on disk are tampered with (it checks registry
metadata only). The lockfile and file-tree-hash checks in `scripts/audit.mjs` cover that.

## 2. Provenance

Every package has an npm publish attestation and SLSA v1 provenance. All were built by
`https://github.com/actions/runner/github-hosted` from `.github/workflows/release.yml`, on a
`release` event in the paulmillr repo. That file is a reusable workflow pinned by SHA,
`paulmillr/jsbt/.github/workflows/release.yml@c138efca67d90dce86a7cc22c01d6b66d193ea7a`, with
actions pinned by SHA, Node 24.19.0, npm 12.0.2, `npm ci --ignore-scripts`,
`npm run build` and `npm stage publish`. The provenance subject digest equals the lockfile
sha512 for all 7.

| Package | Repo @ tag | Commit (= tag HEAD = `gitHead`) | Actions run | Published (UTC) |
|---|---|---|---|---|
| @scure/bip39 | paulmillr/scure-bip39 @ 2.4.0 | 2c8cf46fb4da10ea715aa56fee846142a2c0fa80 | 33196381940 | 2026-08-28 17:57 |
| @scure/bip32 | paulmillr/scure-bip32 @ 2.4.0 | ab00d7f78d067422898fc0adb8a7ef740b79386a | 33196884781 | 2026-08-28 17:56 |
| @scure/btc-signer | paulmillr/scure-btc-signer @ 2.4.1 | 373d2f3ed32478fcf52a088c14c769df3d29acb8 | 33258368069 | 2026-08-29 14:45 |
| @noble/hashes | paulmillr/noble-hashes @ 2.4.0 | 663c2aeeffc308ac0cded59bd32f7c212adacfc2 | 33074534582 | 2026-08-27 13:02 |
| @noble/curves | paulmillr/noble-curves @ 2.4.0 | 656c4364dffa44c64aa0c49914b8000b278b67a9 | 33081677163 | 2026-08-27 14:28 |
| @scure/base | paulmillr/scure-base @ 2.4.0 | d93da4f8fbd7146c3af51c72d65945af72193a7c | 33164431061 | 2026-08-28 17:43 |
| micro-packed | paulmillr/micro-packed @ 0.11.1 | 4cf227ad2f96b4f477469b95f6f64a134791b12c | 33257339077 | 2026-08-29 14:24 |

All seven release commits and annotated tags carry valid PGP signatures from
`Paul Miller <paul@paulmillr.com>`, EdDSA key `78A89CD10959782E23FF8447697079DA6878B89B`. The key
was fetched from `github.com/paulmillr.gpg` and checked with `gpgv`.

For @scure/base, provenance was signed at 10:43 and the package was published at 17:43. That gap
is consistent with staged publishing awaiting maintainer approval, so it is not a concern.

## 3. Published code vs public source (rebuild)

Each repo was cloned at its tag and built as the release workflow does: `npm ci --ignore-scripts`,
`npm run build` (`tsc` 6.0.3 from the repo lockfile), then `npm pack`.

| Package | Rebuilt tarball sha512 == published | Result |
|---|---|---|
| bip39, bip32, hashes, curves, base, micro-packed | yes | byte-identical (npm 11.20.0) |
| btc-signer | yes, with npm 12.0.2 | byte-identical |

The only btc-signer difference was a packing one. With npm 11.20.0 the rebuilt tarball lacks
`src/_type_test.ts`, because npm 11 applies the `files` negation `"!_type_test.*"` to `src/` too.
npm 12.0.2, the version CI used, keeps the file, and packing with it reproduces the published
tarball exactly. That file is a type-level test that is never imported, and it is identical to the
git tag. The Node version (26 here, 24 in CI) does not matter: tsc output was identical.

Conclusion: the published JavaScript is exactly what the signed tagged TypeScript compiles to.

## 4. Static scan

`scripts/audit.mjs` scans every file of the 7 installed packages (213 files). Code-pattern rules
apply to `.js/.ts/.d.ts/.json`. Hard Trojan-Source rules apply to every file, Markdown included.
The `non-ascii` rule applies to runtime `.js/.json`. 10,034 hits, all reviewed and allowlisted
with a per-group content fingerprint. `node scripts/audit.mjs --list` prints every hit, and
`ALLOW_ROWS` in the script lists each one by file and line, including the `.ts` sources and
`.d.ts` copies that repeat the `.js` text.

Rules with **zero hits**:
- `require` / `createRequire` / `module.exports`;
- `child_process`, `worker_threads`, any `node:` module, `getBuiltinModule`;
- `new Function` / `Function(` used as code;
- timers with string arguments;
- long escape-sequence runs and blobs that decode to text;
- bidi or zero-width characters (U+202A-202E, U+2066-2069, U+200B-200F, U+FEFF, tag characters)
  and control characters, in any file;
- imports of anything other than relative paths or declared dependencies, outside JSDoc
  examples.

Hits in runtime files (`.js`/`.json`/`.md`) and verdicts:

| Category | Where | Verdict |
|---|---|---|
| network | btc-signer `net.js:152-154,318,322,340,343-345,348,357` | Benign. `EsploraProvider` calls a `fetch` the caller passes to its constructor; there is no hard-coded endpoint (only a `127.0.0.1` JSDoc example). The project doesn't import it (unreachable from `btc.js`, see below). |
| | bip39 `package.json:28-29` | Dev-only `fetch-wordlist` npm scripts, not lifecycle scripts. |
| | bip39 `wordlists/english.js:684` | The BIP39 word "fetch". |
| process | micro-packed `debugger.js:129` | `process.stdout.columns` for table width in the optional debugger module, which nothing imports. |
| eval | curves `abstract/fft.js:586,616` | A polynomial method named `eval(a, x)` plus a comment, not global `eval`. |
| dynamic import | curves `webcrypto.js:101,118` | A WebCrypto method named `import(key, format)`, not `import()`. Module not used. |
| timers | hashes `utils.js:421,441` | `nextTick()` fallback `host.setTimeout(resolve, 0)` for async KDFs (function argument). |
| | btc-signer `net.js:142` | `sleep()` between retries (arrow function). |
| globals (read) | hashes `utils.js:433,659`, `webcrypto.js:4`; curves `webcrypto.js:54`; bip39 `index.js:277` (doc) | Read `globalThis.crypto.getRandomValues` / `.subtle` and `globalThis.scheduler` only. |
| globals (write) | btc-signer `transaction.js:940,948,975-978,983,2009,2011,2015,2044` (and 28 reads around them) | Benign. These write to a block-scoped `const global` PSBT key map declared at `:938` and `:2007`, not to Node's `global`. The TypeScript checker resolves every `global` to these locals and found **no writes to any real global or prototype anywhere**. |
| prototype | `Object.freeze(X.prototype)` hardening: curves `edwards.js:381`, `weierstrass.js:634,964`, `modular.js:840`, `ed25519.js:517`, `ed448.js:529`. `__proto__` rejection (prototype-pollution guards): hashes `utils.js:140,144,145`, micro-packed `index.js:51`. `Object.prototype.toString/hasOwnProperty.call`: micro-packed `index.js:163,168`. `defineProperty` on the library's own objects: curves `modular.js:679` (`this`), `poseidon.js:319`. Comments: curves `modular.js:677,837`, hashes `utils.js:142,603`, base `index.js:1021`, btc-signer `script.js:205`, micro-packed `debugger.js:203`, `index.js:2616` | Benign: reads, freezes and guards only. |
| **Math.random** | btc-signer `net.js:169` `retryDelay = ... * (0.5 + Math.random())` | **Flagged, benign.** HTTP retry jitter in the unused Esplora client, not key material. It is the only `Math.random` in the tree. |
| randomness | hashes `utils.js:641-669` | `randomBytes()` calls `globalThis.crypto.getRandomValues` only (≤ 65536 bytes) and throws if it is missing. This is the only entropy source in the tree. |
| | `Date.now` at hashes `utils.js:463-472`, `argon2.js:505-514`; btc-signer `net.js:673-729` | Time-slicing and timeouts, not entropy. |
| dom/exfil | `String.fromCharCode`: base `index.js:100,104,108,111,1036,1071,1074`, hashes `eskdf.js:91`, micro-packed `debugger.js:5,6`. `atob`: curves `webcrypto.js:153` | Byte/string conversion and JWK base64url decoding. There is no `document`, storage, `navigator`, `location`, `postMessage`, Worker or WebAssembly. |
| import specifier | base `index.js:741,763` | JSDoc examples importing `sha256` from @noble/hashes. |
| long blobs (533) | curves: secp256k1 `p, n, Gx, Gy, beta` and RFC 9380 isogeny constants (`secp256k1.js`, 21; values match SEC 2), plus parameters for other curves (`bls12-381.js` 89, `misc.js` 31, `ed25519.js` 21, `ed448.js` 18, `nist.js` 18, `bn254.js` 11, `montgomery.js` 2). curves `webcrypto.js` 3: PKCS#8 DER prefixes. base `index.js` 4: base64/base64url alphabets. btc-signer payment/psbt/script/transaction/utxo 30: JSDoc txids/scripts and URLs. | Documented constants and examples. The AST pass puts every blob in a string literal or comment, and none decodes to text. |
| invisible | U+FE0F after an emoji in a README bullet: btc-signer `README.md:6,12`, base `README.md:8,9`, curves `README.md:10` | Emoji presentation selector in prose. |
| non-ASCII (9,238 in .js) | bip39 non-English wordlists (Japanese/Korean/Chinese 2048 each, French 366, Spanish 334). The rest are math or typographic symbols, box-drawing characters and one Japanese comment. | AST check over all 192 `.js/.ts` files (all parse without errors): every non-ASCII character is in a comment (1,481) or string literal (24,892), none in an identifier or code token. |

Semantic pass (TypeScript checker over all 67 `.js` files):
- **Free globals:** 79 distinct, all standard built-ins plus:
  - `globalThis.crypto`;
  - `setTimeout`/`clearTimeout`/`AbortController` (btc-signer `net.js` only);
  - `Math.random` (`net.js:169`);
  - `atob` (curves `webcrypto.js:153`);
  - `console.log` and `process.stdout` (micro-packed `debugger.js`);
  - `encodeURI` (base `index.js:1014`).
- **Not referenced as globals anywhere:** `fetch`, `XMLHttpRequest`, `WebSocket`, `eval`,
  `Function`, `require`, `importScripts`, DOM and storage APIs.

Reachability from the project's imports:
- Entry points: `@scure/bip39`, `bip39/wordlists/english.js`, `@scure/bip32`,
  `@scure/btc-signer` and `@noble/hashes/sha2.js`. They reach 29 files.
- Not reachable: btc-signer `net.js`, `p2p.js`, `musig2.js`; micro-packed `debugger.js`; curves
  `webcrypto.js` and all non-secp256k1 curves; hashes argon2/scrypt/blake/sha3/eskdf/hkdf; and
  the non-English wordlists.
- So every network, `process`, `atob` and `Math.random` hit above is in code the project never
  loads.

Dynamic check:
- **Tripwires:** these were replaced before the libraries were imported: `fetch`,
  `XMLHttpRequest`, `WebSocket`, `EventSource`, `setInterval`, `setImmediate`, `eval`,
  `setTimeout`, `Math.random`, `process.getBuiltinModule` and `process.env`. Then all the tests in
  section 5 ran, including the project's derive, sign and finalize path. None fired.
- **`process.env`:** the only reads came from Node's ESM loader (`WATCH_REPORT_DEPENDENCIES`).
- **`crypto.getRandomValues`:** called twice at import (the noble-curves RNG probe for the signing
  blind), and otherwise only during mnemonic generation, key generation and signing.

## 5. Code paths the project uses

`btc.js` imports `generateMnemonic`, `mnemonicToSeedSync` and `validateMnemonic` with the english
wordlist, `HDKey`, `@scure/btc-signer` (index) and `sha256`.

**@scure/bip39 (`index.js`)**
- `generateMnemonic` (71-76): requires `strength % 32 === 0` and ≤ 256, then
  `entropyToMnemonic(randomBytes(strength / 8))`. Entropy must be 16-32 bytes (50-54).
- Checksum (79-85): the first ENT/32 bits of SHA-256(entropy).
  - `encodeWords` (99-118) splits entropy||checksum into 11-bit indexes and joins with spaces.
  - `decodeWords` (120-146) reverses that and rejects unknown words or a bad checksum.
- `normalize` (42-48) applies NFKD, rejects ill-formed UTF-16 and requires 12/15/18/21/24
  words.
- `mnemonicToSeedSync` (270-275): `pbkdf2(sha512, NFKD(mnemonic), NFKD("mnemonic" +
  passphrase), { c: 2048, dkLen: 64 })`, with the salt from `psalt` (227-231).
- The English wordlist is identical to `bitcoin/bips` `bip-0039/english.txt`.

**@scure/bip32 (`index.js`)**
- `fromMasterSeed` (108-119): seed must be 128-512 bits. I = HMAC-SHA512(key = `"Bitcoin seed"`
  (34-36), seed); IL is the key and IR the chain code. The constructor rejects IL outside
  [1, n-1] (185-186).
- `derive` (199-228): parses `m/…`; `'` adds 0x80000000; an index must be < 2^31.
- `_deriveChild` (233-294):
  - hardened data is `0x00 || k || ser32(i)` (244-245), normal data is `serP(K) || ser32(i)`
    (248-249);
  - I = HMAC-SHA512(chain code, data) (251);
  - child key is `(IL + k) mod n`;
  - it retries with i+1 when IL ≥ n or the key is 0 (274-283), as BIP32 specifies.
- The fingerprint is `hash160(pubkey)` (41, 74).

**@scure/btc-signer**
- **Payments and addresses (`payment.js`):**
  - `p2wpkh` (612-625) requires a valid compressed key, then `hash160` gives `OP_0 <20>`
    (`OutWPKH` 105-119) and a bech32 address.
  - `Address(net).encode` (1218-1236): v0 uses bech32 and v1 uses bech32m (`programToWitness`
    1157-1162); pkh/sh use base58check with the network version byte (1163-1166).
  - `Address(net).decode` (1237-1287): v0 must be bech32 and v1+ bech32m (BIP350); it checks the
    HRP and witness program length (`validateWitness` 1149-1156, BIP141). Base58 payloads must
    be 21 bytes with the network's pkh/sh byte.
  - `OutScript.encode` (300) validates and serializes these templates.
- **Encoding primitives (`@scure/base`):**
  - bech32 uses the BIP173 generators (796) with constant 1 for bech32 and 0x2bc830a3 for bech32m
    (832);
  - addresses are limited to 90 characters and mixed case is rejected (873-905);
  - base58check is a 4-byte double-SHA256 checksum (746-751).
- **Transaction (`transaction.js`):**
  - `addInput` (1228) takes `witnessUtxo`; `addOutputAddress` (1358-1365) is
    `OutScript.encode(Address(net).decode(addr))`.
  - `sign` (1697-1712) signs every input it can and throws if none.
  - In `signIdx` (1505-1689), for P2WPKH the scriptCode is `OP_DUP OP_HASH160 <h160>
    OP_EQUALVERIFY OP_CHECKSIG` (1677-1678). The default sighash is ALL (677). It calls
    `preimageWitnessV0` with the `witnessUtxo` amount, then `signECDSA` (1679-1686).
  - `finalize` (1713, 1909) puts witness `[sig||01, pubkey]` and an empty scriptSig for wpkh
    (1868-1870); it rejects negative fees (1715).
  - `id` (1194-1196) is the reversed double-SHA256 of the witness-stripped serialization; `hex`
    (1188-1190) includes witnesses.
  - `weight` (1140-1168) counts base ×4 and witness ×1; `vsize` = `ceil(weight / 4)` (28, 1169).
- **BIP143 sighash** (`preimageWitnessV0`, 1424-1447): nVersion, hashPrevouts, hashSequence,
  outpoint, scriptCode, amount, nSequence, hashOutputs, nLockTime and the 4-byte sighash type are
  hashed with double SHA-256. ANYONECANPAY/SINGLE/NONE zeroing follows the spec, and the outpoint
  txid is reversed via `TxHashIdx` (277).
- **ECDSA:** `signECDSA` (`utils.js:202-218`) calls `secp256k1.sign(hash, key, { prehash: false })`
  with no extra entropy (`lowR` is off by default) and outputs DER.

**@noble/curves**
- `secp256k1.js:20-28` holds the SEC 2 parameters (a=0, b=7) and 29-35 the GLV constants.
  `secp256k1` is `ecdsa(Point, sha256)` (90).
- In `abstract/weierstrass.js`, defaults are `lowS: true`, `prehash: true` and
  `extraEntropy: false` (824-829).
- `prepSig` (1006-1071) seeds RFC 6979 with `int2octets(d) || bits2octets(h1)` (1016).
  `k2sig` (1037-1069) takes `k = bits2int(T)` within [1, n-1], `r = (kG).x mod n`,
  `s = k^-1(m + rd)`, and normalizes to low-S (1064-1067).
- `sign` (1085-1090) uses an HMAC-SHA256 DRBG (`utils.js:593-650`, RFC 6979 3.2 steps B-H).
- New in 2.x: the nonce inversion is blinded with a random `b` from `randomBytes`
  (`getRandomValues`) at 1048-1055. s is unchanged mathematically, so signatures stay
  deterministic (verified below). Without a CSPRNG it falls back to constant-time inversion.
- DER (`abstract/der.js`) uses minimal INTEGERs with a 0x00 pad for the high bit; the decoder
  rejects non-minimal encodings.

**@noble/hashes**
- `randomBytes` is covered in section 4.
- `hmac.js` follows RFC 2104: keys longer than blockLen are hashed, and the pads are 0x36/0x5c
  (30-39).
- `pbkdf2.js` follows RFC 8018: `U1 = PRF(P, S || INT32BE(i))`, then c rounds of XOR
  (`pbkdf2Engine` 50-88, `pbkdf2` 107-122).
- The SHA-256/SHA-512 IVs (`_md.js:186,206`) are the FIPS 180-4 values.
- The compression functions of sha256, sha512 and ripemd160 were verified by differential
  testing, not line by line.

**Known-answer and differential tests: 441 pass.** References were pinned at bitcoin/bips
`5aadddb5`, trezor/python-mnemonic `b57a5ad7`, bitcoin/bitcoin `ab7e668c` and
trezor/trezor-firmware `95accc10`.

| Area | Result |
|---|---|
| BIP39 | 24 Trezor vectors: entropy↔mnemonic, validation, seed with passphrase "TREZOR" (also matched by OpenSSL PBKDF2), master xprv. Bad checksum rejected. `generateMnemonic` output equals `entropyToMnemonic(bytes from one getRandomValues call)`. |
| BIP32 | Test vectors 1-4 (xprv/xpub per chain, public-only derivation) pass; all vector-5 invalid keys are rejected. |
| BIP84 (project path) | `m/84'/0'/0'/0/0`, `/0/1` and `/1/0` from the spec mnemonic give the spec pubkeys, WIFs and addresses (for example `bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu`). |
| BIP143 P2WPKH | The sighash equals the spec value `c37af311…`, and the RFC 6979 signature reproduces the spec signed transaction byte for byte. |
| RFC 6979 | 5 trezor-firmware nonce vectors: `r == x(kG)` computed by OpenSSL, and low-S. |
| ECDSA vs OpenSSL (400 random) | Same pubkeys; signatures verify under OpenSSL; low-S, strict BIP66 DER, deterministic. |
| Hashes vs OpenSSL | sha256, sha512, ripemd160, HMAC-SHA256/512 on 1,500 random inputs; PBKDF2-SHA512 ×40. |
| Addresses | All BIP350 valid/invalid vectors behave as specified. Bitcoin Core `key_io`: 41 valid addresses decode/encode correctly and all invalid strings are rejected. Witness v2-16 addresses are rejected as unsupported. 5 Taproot vectors whose x-only key is off-curve (confirmed with OpenSSL) are rejected: stricter than BIP350, and it fails safe. |
| End-to-end (`btc.js` payout sequence) | 2 inputs, 2 outputs. Re-verified independently: parse, txid, vsize, output scripts, fee, and each witness signature verified by OpenSSL against an independently computed BIP143 digest. |

## 6. Published audits

| Package | Claimed audit (README) | Report and link check |
|---|---|---|
| @scure/bip39 | Self-audit, v2.2.0, Apr 2026 | No report; "changes since" link 200 |
| | Cure53, v1.0.0, Jan 2022 | cure53.de/pentest-report_hashing-libs.pdf (not fetched); in-repo `audit/2022-01-05-cure53-audit-nbl2.pdf` present at the tag (319,415 B, PDF dated 2022-01-05) |
| @scure/bip32 | Self-audit, v2.2.0, Apr 2026; Cure53, v1.0.1, Jan 2022 | Same Cure53 PDF (identical hash); links 200 |
| @scure/btc-signer | Self-audit, v2.2.0, Apr 2026 | No report; link 200 |
| | Cure53, v0.3.0, Feb 2023 | cure53.de/audit-report_micro-btc-signer.pdf (not fetched); in-repo `audit/2023-02-21-cure53-audit-report.pdf` present (214,815 B) |
| | **"MuSig2 and UTXO selection has not been audited yet"** (`README.md:1489`) | Its "Commit 58d4554" link is relative and 404s; the commit exists (2024-03-26) |
| @noble/hashes | Cure53, v1.0.0, Jan 2022, scope everything except blake3, sha3-addons, sha1, argon2; "AI-assisted self-audits since Apr 2026" | Same Cure53 PDF present; no self-audit reports |
| @noble/curves | Trail of Bits with OpenAI, v2.3.0, Aug 2026 ("Patch the Planet") | **No report link; unverifiable** |
| | Cure53, v1.6.0, Sep 2024, scope ed25519/ed448/bls/bn254/hash-to-curve (not secp256k1) | In-repo `2024-09-cure53-audit-nbl4.pdf` present; website not fetched |
| | Kudelski, v1.2.0, Sep 2023, scope curve/modular/poseidon/weierstrass | In-repo PDF present |
| | Trail of Bits, v0.7.3, Feb 2023, scope weierstrass, secp256k1, modular, utils, hash-to-curve | github.com/trailofbits/publications link 200; that PDF is byte-identical to the in-repo copy (sha256 `1a6e7430c7c7d9a9…`) |
| @scure/base | Self-audit, v2.2.0, Apr 2026; Cure53, v1.0.0, Jan 2022 | Same Cure53 PDF; links 200 |
| micro-packed | None claimed; no `audit/` directory | It does btc-signer's transaction (de)serialization |

UTXO selection: confirmed unaudited per the README. `btc.js` never calls `selectUTXO`; it does
its own largest-first selection (`btc.js:666-684`). btc-signer's `index.js` still loads
`utxo.js` via re-export, but `transaction.js` doesn't import it, and nothing the project calls
depends on it (`vsize` uses `transaction.js:28`).

Coverage takeaway: the third-party audits with reports cover older major versions (1.x, 0.x).
The differences up to the installed 2.4.x were not reviewed here, and most were only
self-audited.

## Notes (not security issues)

- Taproot addresses whose x-only key is not on secp256k1 are rejected, and so are witness v2+
  addresses. `isValidAddress` returns false for both, which is fail-safe.
- Signing uses `crypto.getRandomValues` for inversion blinding; output is still RFC 6979
  deterministic.
- The unused `net.js` Esplora client uses `Math.random` for retry jitter. Don't route anything
  security-relevant through it.

## Known limits

- **Not reviewed line by line:**
  - field and point arithmetic (`abstract/curve.js`, `modular.js`, wNAF/GLV);
  - the SHA-2 and RIPEMD-160 compression functions;
  - micro-packed's coders;
  - PSBT parsing, Taproot, MuSig2, UTXO selection, `net.js` and `p2p.js`.

  These are covered only by the rebuild equivalence, the static and semantic scans, and (for what
  the project uses) the known-answer and differential tests.
- **Not assessed:** constant-time behaviour and side channels.
- **Trust assumptions:**
  - The build toolchain (TypeScript 6.0.3 from the upstream lockfiles) is trusted. I did,
    however, read the shipped `.js` for the paths above, so what was reviewed is what runs.
  - `globalThis.crypto` is trusted to be the platform CSPRNG. Other code in the same page or
    process could replace it; that is outside the packages' control.
- **Not done:**
  - Audit PDF contents were not read, and cure53.de links were not fetched (host not allowed).
  - `btc.browser.js` (the esbuild bundle visitors run) was not compared against these packages.
  - Dev dependencies are out of scope.

## Re-running

`./dev audit` (or `node scripts/audit.mjs` in /repo inside the container). Exit 0 means all of
the following pass:
- the runtime tree, versions, registry URLs and sha512 match the pinned list;
- installed file-tree hashes match and there are no install hooks;
- `npm audit signatures` passes, with provenance repo, tag, commit and digest matching the pins;
- every static-scan hit matches the reviewed allowlist and content fingerprints.

A negative test confirmed the script catches each of these:
- a planted `fetch(...)`;
- a swapped `Math.random` RNG;
- a same-line content change;
- a U+202E character;
- a tampered lockfile hash.

On any upgrade, repeat sections 2-5 before updating `PINNED`, `ALLOW_ROWS` and `FP`.
`--list` prints every hit and the new fingerprints.
