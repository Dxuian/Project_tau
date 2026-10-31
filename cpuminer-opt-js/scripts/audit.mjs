#!/usr/bin/env node
// Re-runnable supply-chain check for the Bitcoin wallet runtime dependencies.
// Run inside the dev container from the repo root: `./dev audit` (or `node scripts/audit.mjs`).
// See AUDIT.md for the manual review this script backs up.
//
//   node scripts/audit.mjs          run all checks, exit 1 on any failure
//   node scripts/audit.mjs --list   also print every scan hit (allowlisted or not), the current
//                                   hit fingerprints and the file-tree hashes, for re-review
//                                   after an upgrade
//
// Checks: (1) package.json + package-lock.json runtime tree == PINNED (versions, registry URLs,
// sha512); installed files == pinned file-tree hashes, no install hooks; (2) `npm audit
// signatures` (registry signatures + SLSA provenance, whose repo/tag/commit/digest must match
// PINNED); (3) static scan of every installed runtime file against the reviewed ALLOW list.
//
// Dependency-free: only node: built-ins. The only network use is `npm audit signatures`.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const NM = join(ROOT, 'node_modules');
const LIST = process.argv.includes('--list');

// ---------------------------------------------------------------------------------------------
// Pinned runtime tree. Any change here must come with a fresh review (see AUDIT.md).
// integrity: registry sha512 (also the SLSA provenance subject digest).
// tree: sha256 over "sha256(file)  relpath\n" for every installed file, sorted by path.
// repo/commit: what the SLSA provenance says the package was built from.
// ---------------------------------------------------------------------------------------------
const PINNED = {
  '@scure/bip39': {
    version: '2.4.0',
    integrity: 'sha512-82dxFbZUYboyOf0AXiydsQrFQ5Q4h9mX+O2UkE91ROYmsc0BKMGZLwDmy96Jpa2+vrtoxomjUhy1RPIgH/r2nA==',
    repo: 'paulmillr/scure-bip39', commit: '2c8cf46fb4da10ea715aa56fee846142a2c0fa80',
    tree: '1e0451d9a8c6555e922471af33b1329e4cc1efb6d41e84a684d21b2a6570e1eb',
  },
  '@scure/bip32': {
    version: '2.4.0',
    integrity: 'sha512-i3DS0CptAocyvqE4n3SUkpzeQK4vJMFwWLofTwRiiKo2aWojBOfyMCgfKw9HVpO6fSY5AK86sHS/Uzn8kK9Few==',
    repo: 'paulmillr/scure-bip32', commit: 'ab00d7f78d067422898fc0adb8a7ef740b79386a',
    tree: 'f0e30a8c4c334ac4db8d8d04cab526a51d40519eb71238d3d5e41f925a93c761',
  },
  '@scure/btc-signer': {
    version: '2.4.1',
    integrity: 'sha512-ch6h66o9nPhEoe/KciMMUJeH2MBPB8UAJI1if35Fxl6885lKTsc9YoCRqTW0/RjI0Vv9GSg1tmKtHHODyAw81g==',
    repo: 'paulmillr/scure-btc-signer', commit: '373d2f3ed32478fcf52a088c14c769df3d29acb8',
    tree: '50ce1540c094d3af835ac421f4f12a24504e316f85702ce0eb3c3310b2b4ed9d',
  },
  '@noble/hashes': {
    version: '2.4.0',
    integrity: 'sha512-X5XaVWZIBCT7HHZGm5I7ZQXDwLG+bGXuSrMQAW+7Zvl87h1kmc1ZB1VSRJcpUfoUrGQp4Fkoxm5kZ+Ms+aW+eA==',
    repo: 'paulmillr/noble-hashes', commit: '663c2aeeffc308ac0cded59bd32f7c212adacfc2',
    tree: '1584d1a8d67619f957c54fcca748df7c52054139511fe5b322f2b3f9a7de9760',
  },
  '@noble/curves': {
    version: '2.4.0',
    integrity: 'sha512-P4/62zrgfH33CneE3Dn4WhJVA22YUU0eR51wKIan4NVRvwsA0YnPTwWGpNbpuacSujmSFLvyzpyuR30+fbq2Ew==',
    repo: 'paulmillr/noble-curves', commit: '656c4364dffa44c64aa0c49914b8000b278b67a9',
    tree: '9a1abd1414183aa9ecaaae216fdb979b1d606b9b39aafd0f66f56f956a9cbfaf',
  },
  '@scure/base': {
    version: '2.4.0',
    integrity: 'sha512-thZ1TuJwFwBblOhgsjDKvvGirBxNp+wSvY/DR6tJBJOTDhdAAcHJ8Vbr2eFnqaxeca4+t0i9KBf+uHYGWwZORg==',
    repo: 'paulmillr/scure-base', commit: 'd93da4f8fbd7146c3af51c72d65945af72193a7c',
    tree: '04631eebc7955bff032e50cb81c6becdde62b402316491c464c27fca2a567b26',
  },
  'micro-packed': {
    version: '0.11.1',
    integrity: 'sha512-agQGBnBCw8OoKQZMUxcaQPaOowdfxyEmBsq4CNAXAXCyB8KxlRG0lTl5GADJIsMEDaFb0trhXBHKYsjTWa5kuw==',
    repo: 'paulmillr/micro-packed', commit: '4cf227ad2f96b4f477469b95f6f64a134791b12c',
    tree: '37f9bdfc37b7f042dfced21c9e0f3dbd1fab9fd0658c7b2010ae6b9093431760',
  },
};
// The project's package.json "dependencies" must be exact pins of packages in PINNED, and must
// include these three (the wallet libraries the review was for).
const REQUIRED_DIRECT = ['@scure/bip39', '@scure/bip32', '@scure/btc-signer'];

// ---------------------------------------------------------------------------------------------
// Static scan rules. Every hit must be on ALLOW below. `hard` rules have no legitimate use in
// these packages and are expected to have zero hits.
// ---------------------------------------------------------------------------------------------
// Bidi controls, zero-width and other invisible/format characters ("Trojan Source"). Built from
// code points so this file itself stays pure ASCII.
const INVISIBLE_RANGES = [
  [0x00ad], [0x061c], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180b, 0x180f], [0x200b, 0x200f],
  [0x2028, 0x202e], [0x2060, 0x206f], [0x3164], [0xfe00, 0xfe0f], [0xfeff], [0xffa0],
  [0xfff9, 0xfffb], [0xe0000, 0xe007f], [0xe0100, 0xe01ef],
];
const cp = String.fromCodePoint;
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map(([a, b = a]) => `${cp(a)}-${cp(b)}`).join('')}]`, 'u');
// `(?<![\w$.])` skips property accesses such as `this.global` or `Poly.eval(`.
const NOT_PROP = '(?<![\\w$.])';
const re = (s) => new RegExp(s);
const RULES = [
  // 1. network APIs and network modules
  { id: 'network', re: /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection|sendBeacon|importScripts)\b|\bnode:(?:http2?|https|net|dgram|tls|dns)\b/ },
  // 2. Node built-ins (bare `from 'fs'` etc. are caught by import-spec below), process
  { id: 'node-builtin', re: /\bchild_process\b|\bworker_threads\b|\bnode:[a-z_/]+|\bgetBuiltinModule\b|\bprocess\.(?:binding|dlopen)\b/ },
  { id: 'process', re: /\bprocess\.[A-Za-z_$]|\bprocess\s*\[|\bprocess\s*\?\.|typeof\s+process\b/ },
  // 3. require / dynamic import
  { id: 'require', re: /\brequire\s*\(|\bcreateRequire\b|\bmodule\.exports\b/ },
  { id: 'dynamic-import', re: re(`${NOT_PROP}import\\s*\\(|\\bimport\\.meta\\b`) },
  // 4. eval / Function constructor
  { id: 'eval', re: re(`${NOT_PROP}eval\\s*\\(|\\bnew\\s+Function\\b|${NOT_PROP}Function\\s*\\(|\\.constructor\\s*\\(\\s*['"\`]`) },
  // 5. timers (any use is listed; a string first argument is a hard failure)
  { id: 'timer', re: /\b(?:setTimeout|setInterval|setImmediate)\b/ },
  { id: 'timer-string', hard: true, re: /\b(?:setTimeout|setInterval|setImmediate)\s*\(\s*['"`]/ },
  // 6. globals and prototypes (reads are listed; writes are a hard failure)
  { id: 'global', re: re(`\\bglobalThis\\b|${NOT_PROP}(?:window|global|self)(?:\\.[A-Za-z_$]|\\s*\\[|\\?\\.)|typeof\\s+(?:window|global|self)\\b|[=(,:]\\s*(?:window|global|self)\\s*[;,)]`) },
  { id: 'prototype', re: /\.prototype\b|__proto__|\bObject\.(?:defineProperty|defineProperties|setPrototypeOf)\b|\bReflect\.(?:set|defineProperty|setPrototypeOf)\b/ },
  { id: 'global-write', hard: true, re: re(`\\.prototype(?:\\.[\\w$]+|\\[[^\\]]+\\])\\s*(?:[-+*/%&|^]|\\?\\?|&&|\\|\\|)?=(?!=)|${NOT_PROP}(?:globalThis|window|global|self)(?:\\.[\\w$]+|\\[[^\\]]+\\])+\\s*(?:[-+*/%&|^]|\\?\\?|&&|\\|\\|)?=(?!=)|__proto__\\s*=(?!=)`) },
  // 7. randomness sources (only crypto.getRandomValues is acceptable for key material)
  { id: 'math-random', hard: true, re: /\bMath\.random\b/ },
  { id: 'randomness', re: /getRandomValues|randomUUID|randomFill|\brandomInt\b|crypto\.randomBytes|\bDate\.now\b|performance\.now/ },
  { id: 'dom-exfil', re: /\b(?:atob|btoa|unescape)\s*\(|String\.fromCharCode|\bdocument\s*\.|\b(?:localStorage|sessionStorage|indexedDB)\b|\bnavigator\s*\.|\blocation\s*\.|\bpostMessage\b|\bnew\s+(?:Shared)?Worker\b|\bWebAssembly\b|\bBroadcastChannel\b/ },
  // 8. long base64/hex blobs and long escape-sequence runs
  { id: 'blob', re: /[A-Za-z0-9+/_-]{64,}={0,2}/ },
  { id: 'escaped-blob', re: /(?:\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\}){8,}/ },
  // 9. Trojan Source: bidi/invisible/control characters (hard, every file), other non-ASCII (.js)
  { id: 'invisible', hard: true, re: INVISIBLE },
  { id: 'control-char', hard: true, re: /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]|\r(?!\n)/ },
  { id: 'non-ascii', re: /[^\x00-\x7F]/ },
];
// Prose files get only the Unicode rules. `non-ascii` is applied to what is loaded at runtime
// (.js/.json); .ts sources and .d.ts types are compiled/ignored (the .js was rebuilt from the
// tagged .ts byte for byte) and still get the hard invisible/control-character rules.
const PROSE = /(?:^|\/)(?:README\.md|LICENSE|CHANGELOG\.md)$/;
const UNICODE_RULES = new Set(['invisible', 'control-char', 'non-ascii']);
const CODE_EXT = /\.(?:js|mjs|cjs|ts|mts|cts|json)$/;
const RUNTIME_EXT = /\.(?:js|mjs|cjs|json)$/;
const ALLOWED_FILES = /\.(?:js|d\.ts|ts|json|md)$|(?:^|\/)LICENSE$/;

// ---------------------------------------------------------------------------------------------
// Allowlist of reviewed, benign hits (see AUDIT.md for the review). Rows are
//   [rule, file, lines | count, why]
// `lines` pins exact line numbers; `count` pins the number of hits in one file (only for bulk
// data: wordlists, constant tables, comments). Hard rules can only be allowlisted by line.
// File contents are pinned by PINNED[*].tree, so both forms are exact. Entries that no longer
// match are reported as stale (failure).
// ---------------------------------------------------------------------------------------------
const WHY = {
  esplora: 'btc-signer net.js EsploraProvider: calls a caller-injected fetch (constructor arg), retry regex/comments; not imported by index.js or by the project',
  wordFetch: 'the BIP39 English word "fetch"',
  devScript: 'dev-only npm scripts (fetch-wordlist) in package.json; not lifecycle scripts, never run on install',
  prose: 'comment/JSDoc prose, not code',
  debuggerTty: 'micro-packed/debugger.js reads process.stdout.columns for table width; optional module nothing imports',
  nextTick: 'noble-hashes nextTick(): host.setTimeout(resolve, 0) fallback for async KDFs (function arg, not a string)',
  netSleep: 'btc-signer net.js sleep() between Esplora retries (arrow-function arg); module not used',
  cryptoRead: 'reads globalThis.crypto (getRandomValues / subtle) or globalThis.scheduler; read-only',
  psbtGlobal: 'btc-signer local `const global` (PSBT global key map, transaction.js:938 and :2007); not the Node global. TypeScript checker: no free `global` reference, no writes to globals',
  protoRead: 'Object.prototype.toString/hasOwnProperty.call type checks, or Object.freeze(X.prototype) hardening, or __proto__ rejection (prototype-pollution guard)',
  defineOwn: 'Object.defineProperty on the library\'s own object (Field instance sqrt hook / poseidon roundConstants), not a global or prototype',
  rngCsprng: 'noble-hashes randomBytes(): globalThis.crypto.getRandomValues (the only entropy source) and its docs',
  dateTick: 'Date.now() to time-slice async loops (asyncLoop / argon2 asyncTick); timing, not entropy',
  netJitter: 'btc-signer net.js: Math.random() retry-backoff jitter and Date.now() timeouts in the Esplora client; not key material; module not used',
  fromCharCode: 'String.fromCharCode for bytes->string conversion (base64/utf8 fallbacks, separators, ANSI escapes in debugger)',
  atobJwk: 'noble-curves webcrypto.js: atob() decodes base64url JWK fields; module not used',
  webcryptoImport: 'noble-curves webcrypto.js: method named import(key, format) (WebCrypto key import), not dynamic import()',
  polyEval: 'noble-curves fft: polynomial method named eval(a, x) and a comment about it, not global eval',
  oprfProse: 'JSDoc prose "Pseudorandom Function (OPRF)", not the Function constructor',
  baseDocImport: '@scure/base JSDoc example importing sha256 from @noble/hashes (documentation only)',
  emojiVS16: 'U+FE0F emoji variation selector after an emoji in a README feature bullet',
  wordlist: 'BIP39 wordlist words inside the wordlist string literal',
  unicodeDoc: 'typographic/math/box-drawing symbols or CJK text in comments or string literals (AST check: none in identifiers or code tokens)',
  curveConst: 'documented curve/field constants (BigInt hex literals: SEC2/RFC/EIP parameters, isogeny/GLV constants), JSDoc test values, URLs in comments',
  btcDocHex: 'JSDoc example txids/scripts and GitHub URLs in comments',
  baseAlphabet: 'base64 / base64url alphabets',
  pkcs8: 'noble-curves webcrypto.js PKCS#8 DER prefix templates for P-256/384/521; module not used',
  netMathRandom: 'btc-signer net.js retryDelay(): Math.random() jitter for Esplora HTTP retry backoff; not key material; module not used',
};
// Reviewed content fingerprint per "rule|file": sha256 (first 16 hex) over "line<TAB>text" of
// every hit in that group. A changed allowlisted line fails even if its line number is unchanged.
const FP = {
  'blob|@noble/curves/abstract/modular.d.ts': 'f5d33327fd602834',
  'blob|@noble/curves/abstract/modular.js': '2be56756601ee5f5',
  'blob|@noble/curves/abstract/montgomery.js': '660a1a718b528dc7',
  'blob|@noble/curves/bls12-381.js': 'ea0e48b427aef17d',
  'blob|@noble/curves/bn254.d.ts': 'e0c07d1c091ade40',
  'blob|@noble/curves/bn254.js': '85983bfc01315c61',
  'blob|@noble/curves/ed25519.d.ts': '2a4016f73aef7483',
  'blob|@noble/curves/ed25519.js': 'e5d2f95faaef1bb0',
  'blob|@noble/curves/ed448.js': 'b981b4b95da5863b',
  'blob|@noble/curves/misc.js': '88146dad8784d2c0',
  'blob|@noble/curves/nist.js': '0bbfa4f32fce61f7',
  'blob|@noble/curves/secp256k1.js': '25089f3ebd079b57',
  'blob|@noble/curves/src/abstract/modular.ts': '514a14d3de7ae57e',
  'blob|@noble/curves/src/abstract/montgomery.ts': '53cd63364474fed4',
  'blob|@noble/curves/src/bls12-381.ts': '6d217cb1981aabf9',
  'blob|@noble/curves/src/bn254.ts': 'be65310b9f0e22ac',
  'blob|@noble/curves/src/ed25519.ts': '9429b42446eae685',
  'blob|@noble/curves/src/ed448.ts': 'cb373d382de1a712',
  'blob|@noble/curves/src/misc.ts': '1ae03297ce459bbb',
  'blob|@noble/curves/src/nist.ts': '9a3491023ecb091c',
  'blob|@noble/curves/src/secp256k1.ts': 'd5e869981833ae95',
  'blob|@noble/curves/src/webcrypto.ts': 'e484858416a19aa9',
  'blob|@noble/curves/webcrypto.js': 'c9d0308f0b3e5199',
  'blob|@scure/base/index.js': '5196712b8c75fb3d',
  'blob|@scure/base/index.ts': 'e8d796e1d533af01',
  'blob|@scure/btc-signer/payment.d.ts': 'b1af8483bc710fb8',
  'blob|@scure/btc-signer/payment.js': 'a781320b8709a043',
  'blob|@scure/btc-signer/psbt.d.ts': 'a22d1bd7ea37dbc7',
  'blob|@scure/btc-signer/psbt.js': '8b7b8cf4ff00dcbb',
  'blob|@scure/btc-signer/script.d.ts': 'f42a4ca83cc3696f',
  'blob|@scure/btc-signer/script.js': '96399d1e15df28a4',
  'blob|@scure/btc-signer/src/_type_test.ts': '45acab3cd2abfb5d',
  'blob|@scure/btc-signer/src/payment.ts': '5f2694a573a15ea6',
  'blob|@scure/btc-signer/src/psbt.ts': '44bc6f4c50ffdad4',
  'blob|@scure/btc-signer/src/script.ts': '905fd4500c8cfd6e',
  'blob|@scure/btc-signer/src/transaction.ts': '610dc6123a40603f',
  'blob|@scure/btc-signer/src/utxo.ts': '770ef1903098cc6a',
  'blob|@scure/btc-signer/transaction.d.ts': 'd4485daf90f656ff',
  'blob|@scure/btc-signer/transaction.js': 'd8e11d46f6f3199f',
  'blob|@scure/btc-signer/utxo.d.ts': '93f710097220e17b',
  'blob|@scure/btc-signer/utxo.js': '5930b857d1049b5f',
  'dom-exfil|@noble/curves/src/webcrypto.ts': '8e49bd23adab649b',
  'dom-exfil|@noble/curves/webcrypto.js': '307b9524021841fb',
  'dom-exfil|@noble/hashes/eskdf.js': '4980e1dd1659bcbe',
  'dom-exfil|@noble/hashes/src/eskdf.ts': '210787611de7656a',
  'dom-exfil|@scure/base/index.js': '5e47e7f4d7c6920f',
  'dom-exfil|@scure/base/index.ts': '779cde465ffd0c40',
  'dom-exfil|micro-packed/debugger.js': '072eaa5ede081b5a',
  'dom-exfil|micro-packed/src/debugger.ts': '832e7239a5b42699',
  'dynamic-import|@noble/curves/src/webcrypto.ts': '4b9f8b1272337ed1',
  'dynamic-import|@noble/curves/webcrypto.js': '8dd11d218b9bf6e3',
  'eval|@noble/curves/abstract/fft.js': 'fe080fdf475c9efb',
  'eval|@noble/curves/abstract/oprf.d.ts': 'bafec3372ecf02a1',
  'eval|@noble/curves/src/abstract/fft.ts': 'e28185f540dcc7b0',
  'eval|@noble/curves/src/abstract/oprf.ts': '39cdbbf1a0e4b7c6',
  'global-write|@scure/btc-signer/src/transaction.ts': '86ce2ab2419675b1',
  'global-write|@scure/btc-signer/transaction.js': 'c25f4b11195f4f25',
  'global|@noble/curves/src/webcrypto.ts': 'a60598e3a664ea85',
  'global|@noble/curves/webcrypto.js': '3629f4faf08ef273',
  'global|@noble/hashes/src/utils.ts': 'e071ad6c57b2b5db',
  'global|@noble/hashes/src/webcrypto.ts': 'f2f1ff1bd139e3fe',
  'global|@noble/hashes/utils.js': '948113edb6070ee1',
  'global|@noble/hashes/webcrypto.js': '84049af0d0f85a7c',
  'global|@scure/bip39/index.d.ts': 'd88c768fdde37bf9',
  'global|@scure/bip39/index.js': '2184d6ba5c32c02e',
  'global|@scure/bip39/src/index.ts': '457f928c5a97df97',
  'global|@scure/btc-signer/src/transaction.ts': '73eb6876c1fd049a',
  'global|@scure/btc-signer/transaction.js': 'f70fb7436f61928c',
  'import-spec|@scure/base/index.d.ts': '6bd2440df7a4692f',
  'import-spec|@scure/base/index.js': 'cddf24fa8f2be235',
  'import-spec|@scure/base/index.ts': '0acf6def9dd5f8d4',
  'invisible|@noble/curves/README.md': 'ccaddd17dc82b4e7',
  'invisible|@scure/base/README.md': '039f473dd95304a5',
  'invisible|@scure/btc-signer/README.md': 'cadf6421b7207a60',
  'math-random|@scure/btc-signer/net.js': '10ebce511414de5c',
  'math-random|@scure/btc-signer/src/net.ts': '47ca7b6d5015dbaf',
  'network|@noble/curves/abstract/weierstrass.d.ts': '8869e7ceb5e2480c',
  'network|@noble/curves/src/abstract/weierstrass.ts': '4724cb5add960dee',
  'network|@scure/bip39/package.json': 'cdaf6ca772847228',
  'network|@scure/bip39/wordlists/english.js': 'cd59fa4b5cde17ab',
  'network|@scure/btc-signer/net.d.ts': '4f23870279703590',
  'network|@scure/btc-signer/net.js': 'b9cb6b384fb3766f',
  'network|@scure/btc-signer/src/net.ts': '7e990cdd1f8bc242',
  'non-ascii|@noble/curves/abstract/bls.js': 'fecc836167b6ee7d',
  'non-ascii|@noble/curves/abstract/curve.js': 'acafd1c4a79a4df8',
  'non-ascii|@noble/curves/abstract/edwards.js': '44345416792772b2',
  'non-ascii|@noble/curves/abstract/fft.js': 'f06ba19c9e249fe3',
  'non-ascii|@noble/curves/abstract/frost.js': '4211ec0c1c81cf81',
  'non-ascii|@noble/curves/abstract/hash-to-curve.js': '2a2b9cc1ef4acfd2',
  'non-ascii|@noble/curves/abstract/modular.js': 'f56f028131c84371',
  'non-ascii|@noble/curves/abstract/montgomery.js': '381f234d8c08356a',
  'non-ascii|@noble/curves/abstract/oprf.js': '7c363e6be11a2b2b',
  'non-ascii|@noble/curves/abstract/poseidon.js': 'c6a5f571de8dee6a',
  'non-ascii|@noble/curves/abstract/tower.js': '70c6c25859d6e6b6',
  'non-ascii|@noble/curves/abstract/weierstrass.js': '7117457420e34a78',
  'non-ascii|@noble/curves/bls12-381.js': 'ef1c96943ac20abb',
  'non-ascii|@noble/curves/bn254.js': '61b2ef868e3c6db7',
  'non-ascii|@noble/curves/ed25519.js': '93673c47986dc40b',
  'non-ascii|@noble/curves/ed448.js': '8ead0962e16f672f',
  'non-ascii|@noble/curves/misc.js': 'c3252df4e1cfe706',
  'non-ascii|@noble/curves/secp256k1.js': '9ccd278e094e008d',
  'non-ascii|@noble/hashes/_blake.js': 'd67e5c9886330518',
  'non-ascii|@noble/hashes/_md.js': '69d9d22b173ad197',
  'non-ascii|@noble/hashes/argon2.js': '70be390d3d831596',
  'non-ascii|@noble/hashes/blake2.js': 'f01922b6ed99a66d',
  'non-ascii|@noble/hashes/hkdf.js': '490a817f430a0c51',
  'non-ascii|@noble/hashes/hmac.js': '71e50756a49b3579',
  'non-ascii|@noble/hashes/legacy.js': '37965a6b1c444f04',
  'non-ascii|@noble/hashes/pbkdf2.js': '7cb24da3f91bc388',
  'non-ascii|@noble/hashes/scrypt.js': '99a335a239cbd4ff',
  'non-ascii|@noble/hashes/sha2.js': '789997bc60945a57',
  'non-ascii|@noble/hashes/sha3-addons.js': 'fbf25d05977afaf3',
  'non-ascii|@noble/hashes/sha3.js': '53375c6ec1ecacc6',
  'non-ascii|@noble/hashes/utils.js': '11dc9b67f2f75deb',
  'non-ascii|@noble/hashes/webcrypto.js': 'db6dad66b7e31130',
  'non-ascii|@scure/base/index.js': '33ee6f837d87d1ff',
  'non-ascii|@scure/bip39/index.js': '969fa8b93c9709d7',
  'non-ascii|@scure/bip39/wordlists/french.js': '0a3b5f6b5ecda67a',
  'non-ascii|@scure/bip39/wordlists/japanese.js': 'd745086cf61588b6',
  'non-ascii|@scure/bip39/wordlists/korean.js': 'f57f28049769251b',
  'non-ascii|@scure/bip39/wordlists/simplified-chinese.js': '40ad6a20fc4836a6',
  'non-ascii|@scure/bip39/wordlists/spanish.js': '955df18b4e7c42af',
  'non-ascii|@scure/bip39/wordlists/traditional-chinese.js': 'd4da8ae6ef907fd1',
  'non-ascii|@scure/btc-signer/net.js': '6cd3c1cb3e655be0',
  'non-ascii|micro-packed/debugger.js': 'ebffa9dfd85ad845',
  'non-ascii|micro-packed/index.js': 'bbb55bd6a2c59d2e',
  'process|micro-packed/debugger.js': 'c18cf9de32926fde',
  'process|micro-packed/src/debugger.ts': '5866fc70c4272f14',
  'prototype|@noble/curves/abstract/edwards.js': '4577ea1d7938380a',
  'prototype|@noble/curves/abstract/modular.js': 'd557ec8cca90fed8',
  'prototype|@noble/curves/abstract/poseidon.js': '0e9e31746b2ae7e9',
  'prototype|@noble/curves/abstract/weierstrass.js': 'cffb6d3917562220',
  'prototype|@noble/curves/ed25519.js': '7c60eb8b93b68d05',
  'prototype|@noble/curves/ed448.js': 'c392e42c33efe339',
  'prototype|@noble/curves/src/abstract/edwards.ts': '2612b121c0534641',
  'prototype|@noble/curves/src/abstract/modular.ts': '5fe316a8b888bd3c',
  'prototype|@noble/curves/src/abstract/poseidon.ts': '975cff94763e4383',
  'prototype|@noble/curves/src/abstract/weierstrass.ts': 'ccff8ccd7c131465',
  'prototype|@noble/curves/src/ed25519.ts': 'aea67e865812b619',
  'prototype|@noble/curves/src/ed448.ts': '304eedd11b4b4cdb',
  'prototype|@noble/hashes/src/utils.ts': '5cb15b60387fcf2f',
  'prototype|@noble/hashes/utils.js': 'e130923acd4078cf',
  'prototype|@scure/base/index.js': '4ebcc2120f517454',
  'prototype|@scure/base/index.ts': '3632baec58a40ef3',
  'prototype|@scure/btc-signer/script.js': '1be23cd1b9ffccd4',
  'prototype|@scure/btc-signer/src/script.ts': 'b05d26b45e709971',
  'prototype|micro-packed/debugger.js': 'a6425d38fffe0ad7',
  'prototype|micro-packed/index.js': 'fb8fe28882a6c5b2',
  'prototype|micro-packed/src/debugger.ts': '692da67f289587db',
  'prototype|micro-packed/src/index.ts': 'a6705dd4deb22b48',
  'randomness|@noble/hashes/argon2.js': 'ec59425ae8b21ba5',
  'randomness|@noble/hashes/src/argon2.ts': '3e39f53f8ff48139',
  'randomness|@noble/hashes/src/utils.ts': 'e540d5d5788a545c',
  'randomness|@noble/hashes/utils.d.ts': 'd55438a9743bae68',
  'randomness|@noble/hashes/utils.js': 'f14ae663f2ac5f41',
  'randomness|@scure/btc-signer/net.js': 'b3addb2aeb205682',
  'randomness|@scure/btc-signer/src/net.ts': 'a6e0df6f9640f5e7',
  'timer|@noble/hashes/src/utils.ts': 'bde02ca925fb7fb7',
  'timer|@noble/hashes/utils.d.ts': 'd23937105d602ef9',
  'timer|@noble/hashes/utils.js': '7ebaa65c48daa13a',
  'timer|@scure/btc-signer/net.js': 'e837a5afb9e0ce17',
  'timer|@scure/btc-signer/src/net.ts': '53724bed74442959',
};
const ALLOW_ROWS = [
  ['invisible', '@noble/curves/README.md', [10], 'emojiVS16'],
  ['non-ascii', '@noble/curves/abstract/bls.js', 11, 'unicodeDoc'],
  ['non-ascii', '@noble/curves/abstract/curve.js', 31, 'unicodeDoc'],
  ['non-ascii', '@noble/curves/abstract/edwards.js', 22, 'unicodeDoc'],
  ['prototype', '@noble/curves/abstract/edwards.js', [381], 'protoRead'],
  ['eval', '@noble/curves/abstract/fft.js', [586, 616], 'polyEval'],
  ['non-ascii', '@noble/curves/abstract/fft.js', 10, 'unicodeDoc'],
  ['non-ascii', '@noble/curves/abstract/frost.js', 5, 'unicodeDoc'],
  ['non-ascii', '@noble/curves/abstract/hash-to-curve.js', 7, 'unicodeDoc'],
  ['blob', '@noble/curves/abstract/modular.d.ts', 1, 'curveConst'],
  ['blob', '@noble/curves/abstract/modular.js', 2, 'curveConst'],
  ['non-ascii', '@noble/curves/abstract/modular.js', 18, 'unicodeDoc'],
  ['prototype', '@noble/curves/abstract/modular.js', [677, 837], 'prose'],
  ['prototype', '@noble/curves/abstract/modular.js', [679], 'defineOwn'],
  ['prototype', '@noble/curves/abstract/modular.js', [840], 'protoRead'],
  ['blob', '@noble/curves/abstract/montgomery.js', 2, 'curveConst'],
  ['non-ascii', '@noble/curves/abstract/montgomery.js', 2, 'unicodeDoc'],
  ['eval', '@noble/curves/abstract/oprf.d.ts', [154, 202, 259], 'oprfProse'],
  ['non-ascii', '@noble/curves/abstract/oprf.js', 5, 'unicodeDoc'],
  ['non-ascii', '@noble/curves/abstract/poseidon.js', 3, 'unicodeDoc'],
  ['prototype', '@noble/curves/abstract/poseidon.js', [319], 'defineOwn'],
  ['non-ascii', '@noble/curves/abstract/tower.js', 20, 'unicodeDoc'],
  ['network', '@noble/curves/abstract/weierstrass.d.ts', [60], 'prose'],
  ['non-ascii', '@noble/curves/abstract/weierstrass.js', 26, 'unicodeDoc'],
  ['prototype', '@noble/curves/abstract/weierstrass.js', [634, 964], 'protoRead'],
  ['blob', '@noble/curves/bls12-381.js', 89, 'curveConst'],
  ['non-ascii', '@noble/curves/bls12-381.js', 39, 'unicodeDoc'],
  ['blob', '@noble/curves/bn254.d.ts', 1, 'curveConst'],
  ['blob', '@noble/curves/bn254.js', 11, 'curveConst'],
  ['non-ascii', '@noble/curves/bn254.js', 7, 'unicodeDoc'],
  ['blob', '@noble/curves/ed25519.d.ts', 1, 'curveConst'],
  ['blob', '@noble/curves/ed25519.js', 21, 'curveConst'],
  ['non-ascii', '@noble/curves/ed25519.js', 18, 'unicodeDoc'],
  ['prototype', '@noble/curves/ed25519.js', [517], 'protoRead'],
  ['blob', '@noble/curves/ed448.js', 18, 'curveConst'],
  ['non-ascii', '@noble/curves/ed448.js', 16, 'unicodeDoc'],
  ['prototype', '@noble/curves/ed448.js', [529], 'protoRead'],
  ['blob', '@noble/curves/misc.js', 31, 'curveConst'],
  ['non-ascii', '@noble/curves/misc.js', 1, 'unicodeDoc'],
  ['blob', '@noble/curves/nist.js', 18, 'curveConst'],
  ['blob', '@noble/curves/secp256k1.js', 21, 'curveConst'],
  ['non-ascii', '@noble/curves/secp256k1.js', 14, 'unicodeDoc'],
  ['prototype', '@noble/curves/src/abstract/edwards.ts', [651], 'protoRead'],
  ['eval', '@noble/curves/src/abstract/fft.ts', [875, 902], 'polyEval'],
  ['blob', '@noble/curves/src/abstract/modular.ts', 2, 'curveConst'],
  ['prototype', '@noble/curves/src/abstract/modular.ts', [907, 1068], 'prose'],
  ['prototype', '@noble/curves/src/abstract/modular.ts', [909], 'defineOwn'],
  ['prototype', '@noble/curves/src/abstract/modular.ts', [1071], 'protoRead'],
  ['blob', '@noble/curves/src/abstract/montgomery.ts', 2, 'curveConst'],
  ['eval', '@noble/curves/src/abstract/oprf.ts', [173, 230, 313], 'oprfProse'],
  ['prototype', '@noble/curves/src/abstract/poseidon.ts', [386], 'defineOwn'],
  ['network', '@noble/curves/src/abstract/weierstrass.ts', [160], 'prose'],
  ['prototype', '@noble/curves/src/abstract/weierstrass.ts', [1032, 1449], 'protoRead'],
  ['blob', '@noble/curves/src/bls12-381.ts', 89, 'curveConst'],
  ['blob', '@noble/curves/src/bn254.ts', 11, 'curveConst'],
  ['blob', '@noble/curves/src/ed25519.ts', 21, 'curveConst'],
  ['prototype', '@noble/curves/src/ed25519.ts', [599], 'protoRead'],
  ['blob', '@noble/curves/src/ed448.ts', 18, 'curveConst'],
  ['prototype', '@noble/curves/src/ed448.ts', [645], 'protoRead'],
  ['blob', '@noble/curves/src/misc.ts', 31, 'curveConst'],
  ['blob', '@noble/curves/src/nist.ts', 18, 'curveConst'],
  ['blob', '@noble/curves/src/secp256k1.ts', 21, 'curveConst'],
  ['blob', '@noble/curves/src/webcrypto.ts', 3, 'pkcs8'],
  ['dom-exfil', '@noble/curves/src/webcrypto.ts', [200], 'atobJwk'],
  ['dynamic-import', '@noble/curves/src/webcrypto.ts', [121, 145, 166], 'webcryptoImport'],
  ['global', '@noble/curves/src/webcrypto.ts', [66], 'cryptoRead'],
  ['blob', '@noble/curves/webcrypto.js', 3, 'pkcs8'],
  ['dom-exfil', '@noble/curves/webcrypto.js', [153], 'atobJwk'],
  ['dynamic-import', '@noble/curves/webcrypto.js', [101, 118], 'webcryptoImport'],
  ['global', '@noble/curves/webcrypto.js', [54], 'cryptoRead'],
  ['non-ascii', '@noble/hashes/_blake.js', 2, 'unicodeDoc'],
  ['non-ascii', '@noble/hashes/_md.js', 4, 'unicodeDoc'],
  ['non-ascii', '@noble/hashes/argon2.js', 7, 'unicodeDoc'],
  ['randomness', '@noble/hashes/argon2.js', [505, 507, 509, 514], 'dateTick'],
  ['non-ascii', '@noble/hashes/blake2.js', 3, 'unicodeDoc'],
  ['dom-exfil', '@noble/hashes/eskdf.js', [91], 'fromCharCode'],
  ['non-ascii', '@noble/hashes/hkdf.js', 4, 'unicodeDoc'],
  ['non-ascii', '@noble/hashes/hmac.js', 1, 'unicodeDoc'],
  ['non-ascii', '@noble/hashes/legacy.js', 2, 'unicodeDoc'],
  ['non-ascii', '@noble/hashes/pbkdf2.js', 12, 'unicodeDoc'],
  ['non-ascii', '@noble/hashes/scrypt.js', 7, 'unicodeDoc'],
  ['non-ascii', '@noble/hashes/sha2.js', 13, 'unicodeDoc'],
  ['non-ascii', '@noble/hashes/sha3-addons.js', 12, 'unicodeDoc'],
  ['non-ascii', '@noble/hashes/sha3.js', 5, 'unicodeDoc'],
  ['randomness', '@noble/hashes/src/argon2.ts', [609, 611, 613, 617], 'dateTick'],
  ['dom-exfil', '@noble/hashes/src/eskdf.ts', [103], 'fromCharCode'],
  ['global', '@noble/hashes/src/utils.ts', [582, 949], 'cryptoRead'],
  ['prototype', '@noble/hashes/src/utils.ts', [263, 267], 'protoRead'],
  ['prototype', '@noble/hashes/src/utils.ts', [265, 775], 'prose'],
  ['randomness', '@noble/hashes/src/utils.ts', [616, 619, 620, 624], 'dateTick'],
  ['randomness', '@noble/hashes/src/utils.ts', [931, 934, 939, 950, 951, 959], 'rngCsprng'],
  ['timer', '@noble/hashes/src/utils.ts', [570, 589], 'nextTick'],
  ['global', '@noble/hashes/src/webcrypto.ts', [17], 'cryptoRead'],
  ['randomness', '@noble/hashes/utils.d.ts', [531, 534, 539], 'rngCsprng'],
  ['timer', '@noble/hashes/utils.d.ts', [306], 'nextTick'],
  ['global', '@noble/hashes/utils.js', [433, 659], 'cryptoRead'],
  ['non-ascii', '@noble/hashes/utils.js', 1, 'unicodeDoc'],
  ['prototype', '@noble/hashes/utils.js', [140, 144, 145], 'protoRead'],
  ['prototype', '@noble/hashes/utils.js', [142, 603], 'prose'],
  ['randomness', '@noble/hashes/utils.js', [463, 466, 467, 472], 'dateTick'],
  ['randomness', '@noble/hashes/utils.js', [641, 644, 649, 660, 661, 669], 'rngCsprng'],
  ['timer', '@noble/hashes/utils.js', [421, 441], 'nextTick'],
  ['global', '@noble/hashes/webcrypto.js', [4], 'cryptoRead'],
  ['non-ascii', '@noble/hashes/webcrypto.js', 3, 'unicodeDoc'],
  ['invisible', '@scure/base/README.md', [8, 9], 'emojiVS16'],
  ['import-spec', '@scure/base/index.d.ts', [281, 298], 'baseDocImport'],
  ['blob', '@scure/base/index.js', 4, 'baseAlphabet'],
  ['dom-exfil', '@scure/base/index.js', [100, 104, 108, 111, 1036, 1071, 1074], 'fromCharCode'],
  ['import-spec', '@scure/base/index.js', [741, 763], 'baseDocImport'],
  ['non-ascii', '@scure/base/index.js', 8, 'unicodeDoc'],
  ['prototype', '@scure/base/index.js', [1021], 'prose'],
  ['blob', '@scure/base/index.ts', 4, 'baseAlphabet'],
  ['dom-exfil', '@scure/base/index.ts', [269, 273, 275, 278, 1334, 1368, 1371], 'fromCharCode'],
  ['import-spec', '@scure/base/index.ts', [946, 972], 'baseDocImport'],
  ['prototype', '@scure/base/index.ts', [1319], 'prose'],
  ['global', '@scure/bip39/index.d.ts', [114], 'prose'],
  ['global', '@scure/bip39/index.js', [277], 'prose'],
  ['non-ascii', '@scure/bip39/index.js', 1, 'unicodeDoc'],
  ['network', '@scure/bip39/package.json', [28, 29], 'devScript'],
  ['global', '@scure/bip39/src/index.ts', [281], 'prose'],
  ['network', '@scure/bip39/wordlists/english.js', [684], 'wordFetch'],
  ['non-ascii', '@scure/bip39/wordlists/french.js', 366, 'wordlist'],
  ['non-ascii', '@scure/bip39/wordlists/japanese.js', 2048, 'wordlist'],
  ['non-ascii', '@scure/bip39/wordlists/korean.js', 2048, 'wordlist'],
  ['non-ascii', '@scure/bip39/wordlists/simplified-chinese.js', 2048, 'wordlist'],
  ['non-ascii', '@scure/bip39/wordlists/spanish.js', 334, 'wordlist'],
  ['non-ascii', '@scure/bip39/wordlists/traditional-chinese.js', 2048, 'wordlist'],
  ['invisible', '@scure/btc-signer/README.md', [6, 12], 'emojiVS16'],
  ['network', '@scure/btc-signer/net.d.ts', [25, 239, 243, 261, 264], 'esplora'],
  ['math-random', '@scure/btc-signer/net.js', [169], 'netMathRandom'],
  ['network', '@scure/btc-signer/net.js', [152, 153, 154, 318, 322, 340, 343, 344, 345, 348, 357], 'esplora'],
  ['non-ascii', '@scure/btc-signer/net.js', 1, 'unicodeDoc'],
  ['randomness', '@scure/btc-signer/net.js', [673, 677, 699, 724, 729], 'netJitter'],
  ['timer', '@scure/btc-signer/net.js', [142], 'netSleep'],
  ['blob', '@scure/btc-signer/payment.d.ts', 13, 'btcDocHex'],
  ['blob', '@scure/btc-signer/payment.js', 12, 'btcDocHex'],
  ['blob', '@scure/btc-signer/psbt.d.ts', 4, 'btcDocHex'],
  ['blob', '@scure/btc-signer/psbt.js', 4, 'btcDocHex'],
  ['blob', '@scure/btc-signer/script.d.ts', 3, 'btcDocHex'],
  ['blob', '@scure/btc-signer/script.js', 7, 'btcDocHex'],
  ['prototype', '@scure/btc-signer/script.js', [205], 'prose'],
  ['blob', '@scure/btc-signer/src/_type_test.ts', 5, 'btcDocHex'],
  ['math-random', '@scure/btc-signer/src/net.ts', [393], 'netMathRandom'],
  ['network', '@scure/btc-signer/src/net.ts', [44, 374, 375, 377, 538, 542, 560, 563, 564, 566, 575], 'esplora'],
  ['randomness', '@scure/btc-signer/src/net.ts', [905, 908, 928, 951, 955], 'netJitter'],
  ['timer', '@scure/btc-signer/src/net.ts', [365], 'netSleep'],
  ['blob', '@scure/btc-signer/src/payment.ts', 13, 'btcDocHex'],
  ['blob', '@scure/btc-signer/src/psbt.ts', 4, 'btcDocHex'],
  ['blob', '@scure/btc-signer/src/script.ts', 7, 'btcDocHex'],
  ['prototype', '@scure/btc-signer/src/script.ts', [225], 'prose'],
  ['blob', '@scure/btc-signer/src/transaction.ts', 4, 'btcDocHex'],
  ['global', '@scure/btc-signer/src/transaction.ts', [1086, 1101, 1126, 1127, 1135, 1148, 1149, 1151, 1154, 1155, 1156, 1157, 1162, 1163, 1164, 1165, 1166, 1171, 1173, 1193, 2194, 2257, 2258, 2259, 2260, 2302, 2316], 'psbtGlobal'],
  ['global-write', '@scure/btc-signer/src/transaction.ts', [1127, 1135, 1163, 1164, 1165, 1166, 1173, 2257, 2258, 2260, 2302], 'psbtGlobal'],
  ['blob', '@scure/btc-signer/src/utxo.ts', 3, 'btcDocHex'],
  ['blob', '@scure/btc-signer/transaction.d.ts', 3, 'btcDocHex'],
  ['blob', '@scure/btc-signer/transaction.js', 4, 'btcDocHex'],
  ['global', '@scure/btc-signer/transaction.js', [912, 925, 939, 940, 948, 959, 960, 962, 965, 966, 967, 968, 974, 975, 976, 977, 978, 982, 983, 1003, 1947, 2009, 2011, 2013, 2015, 2043, 2044, 2052], 'psbtGlobal'],
  ['global-write', '@scure/btc-signer/transaction.js', [940, 948, 975, 976, 977, 978, 983, 2009, 2011, 2015, 2044], 'psbtGlobal'],
  ['blob', '@scure/btc-signer/utxo.d.ts', 1, 'btcDocHex'],
  ['blob', '@scure/btc-signer/utxo.js', 3, 'btcDocHex'],
  ['dom-exfil', 'micro-packed/debugger.js', [5, 6], 'fromCharCode'],
  ['non-ascii', 'micro-packed/debugger.js', 4, 'unicodeDoc'],
  ['process', 'micro-packed/debugger.js', [129], 'debuggerTty'],
  ['prototype', 'micro-packed/debugger.js', [203], 'prose'],
  ['non-ascii', 'micro-packed/index.js', 1, 'unicodeDoc'],
  ['prototype', 'micro-packed/index.js', [51, 163, 168], 'protoRead'],
  ['prototype', 'micro-packed/index.js', [2616], 'prose'],
  ['dom-exfil', 'micro-packed/src/debugger.ts', [17, 18], 'fromCharCode'],
  ['process', 'micro-packed/src/debugger.ts', [139], 'debuggerTty'],
  ['prototype', 'micro-packed/src/debugger.ts', [213], 'prose'],
  ['prototype', 'micro-packed/src/index.ts', [57, 163, 170], 'protoRead'],
  ['prototype', 'micro-packed/src/index.ts', [2831], 'prose'],
];
const ALLOW = {};
for (const [rule, file, spec, why] of ALLOW_ROWS) {
  if (!WHY[why]) throw new Error(`audit.mjs: unknown reason key ${why}`);
  const cur = (ALLOW[rule] ??= {})[file];
  if (cur && Array.isArray(spec) && cur.lines) { cur.lines.push(...spec); cur.why += `; ${WHY[why]}`; continue; }
  if (cur) throw new Error(`audit.mjs: duplicate allowlist row ${rule} ${file}`);
  ALLOW[rule][file] = Array.isArray(spec) ? { lines: [...spec], why: WHY[why] } : { count: spec, why: WHY[why] };
}

// ---------------------------------------------------------------------------------------------
const results = [];
const ok = (name, detail = '') => results.push({ name, pass: true, detail });
const fail = (name, detail) => results.push({ name, pass: false, detail });
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) out.push({ p, symlink: true });
    else if (e.isDirectory()) out.push(...walk(p));
    else out.push({ p });
  }
  return out;
}

// 1. Lockfile tree, versions, integrity --------------------------------------------------------
function checkLockfile() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const errs = [];
  const deps = pkg.dependencies || {};
  for (const [d, v] of Object.entries(deps))
    if (PINNED[d]?.version !== v) errs.push(`package.json dependency ${d}@${v} is not a pinned, reviewed version`);
  for (const d of REQUIRED_DIRECT) if (!deps[d]) errs.push(`package.json is missing ${d}`);
  const lockRoot = lock.packages?.['']?.dependencies || {};
  if (JSON.stringify(Object.entries(lockRoot).sort()) !== JSON.stringify(Object.entries(deps).sort()))
    errs.push('lockfile root "dependencies" differ from package.json (run npm install --ignore-scripts)');
  if (pkg.optionalDependencies || pkg.peerDependencies || pkg.bundleDependencies || pkg.bundledDependencies)
    errs.push('package.json has optional/peer/bundled dependencies');
  if (lock.lockfileVersion !== 3) errs.push(`unexpected lockfileVersion ${lock.lockfileVersion}`);

  const runtime = Object.entries(lock.packages).filter(([k, v]) => k !== '' && v.dev !== true);
  const names = runtime.map(([k]) => k.replace(/^.*node_modules\//, ''));
  for (const [k, v] of runtime) {
    const name = k.replace(/^.*node_modules\//, '');
    const pin = PINNED[name];
    if (k !== `node_modules/${name}`) { errs.push(`${k}: nested/aliased runtime entry`); continue; }
    if (!pin) { errs.push(`${k}: not in the pinned list`); continue; }
    if (v.version !== pin.version) errs.push(`${name}: version ${v.version} != ${pin.version}`);
    if (v.integrity !== pin.integrity) errs.push(`${name}: integrity differs from pinned`);
    if (!/^sha512-/.test(v.integrity || '')) errs.push(`${name}: integrity is not sha512`);
    const base = name.split('/').pop();
    const want = `https://registry.npmjs.org/${name}/-/${base}-${pin.version}.tgz`;
    if (v.resolved !== want) errs.push(`${name}: resolved ${v.resolved} != ${want}`);
    if (v.link || v.inBundle || v.hasInstallScript || v.bin || v.optional || v.devOptional || v.peer)
      errs.push(`${name}: unexpected flag (link/inBundle/hasInstallScript/bin/optional/peer)`);
    for (const d of Object.keys({ ...v.dependencies, ...v.optionalDependencies, ...v.peerDependencies }))
      if (!PINNED[d]) errs.push(`${name}: depends on unpinned ${d}`);
    for (const [d, r] of Object.entries(v.dependencies || {}))
      if (PINNED[d] && r !== PINNED[d].version) errs.push(`${name}: wants ${d}@${r}, pinned ${PINNED[d].version}`);
  }
  for (const n of Object.keys(PINNED)) if (!names.includes(n)) errs.push(`${n}: missing from lockfile runtime tree`);
  if (errs.length) fail('lockfile runtime tree', errs.join('\n'));
  else ok('lockfile runtime tree', `${runtime.length} packages, versions/resolved/sha512 match pinned list`);
}

// 1b. Installed packages: version, no install scripts, no nested deps, file tree hash ---------
function checkInstalled(trees) {
  const errs = [];
  for (const [name, pin] of Object.entries(PINNED)) {
    const dir = join(NM, name);
    if (!existsSync(join(dir, 'package.json'))) { errs.push(`${name}: not installed`); continue; }
    const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (pj.name !== name || pj.version !== pin.version) errs.push(`${name}: installed ${pj.name}@${pj.version}`);
    const hooks = ['preinstall', 'install', 'postinstall', 'prepare', 'preprepare', 'postprepare', 'prepublish'];
    for (const h of hooks) if (pj.scripts?.[h]) errs.push(`${name}: has lifecycle script "${h}"`);
    if (pj.bin || pj.gypfile || pj.bundleDependencies || pj.bundledDependencies || pj.optionalDependencies)
      errs.push(`${name}: has bin/gypfile/bundled/optional deps`);
    const files = walk(dir);
    const rows = [];
    for (const f of files) {
      const rel = relative(dir, f.p).split(sep).join('/');
      if (f.symlink) { errs.push(`${name}: symlink ${rel}`); continue; }
      if (rel.split('/').includes('node_modules')) errs.push(`${name}: nested node_modules (${rel})`);
      if (!ALLOWED_FILES.test(rel)) errs.push(`${name}: unexpected file type ${rel}`);
      rows.push(`${sha256(readFileSync(f.p))}  ${rel}\n`);
    }
    rows.sort((a, b) => (a.slice(66) < b.slice(66) ? -1 : 1));
    const tree = sha256(rows.join(''));
    trees[name] = { tree, files: rows.length };
    if (tree !== pin.tree) errs.push(`${name}: file tree hash ${tree} != pinned`);
  }
  if (errs.length) fail('installed packages', errs.join('\n'));
  else ok('installed packages', 'versions match, no install hooks/bins/nested deps, file-tree hashes match');
}

// 2. npm audit signatures (registry signatures + provenance attestations) ----------------------
function checkSignatures() {
  const r = spawnSync('npm', ['audit', 'signatures', '--json', '--include-attestations'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  let j;
  try { j = JSON.parse(r.stdout); } catch {
    return fail('npm audit signatures', `exit ${r.status}, unparseable output:\n${(r.stderr || r.stdout || '').slice(0, 2000)}`);
  }
  const errs = [];
  if (r.status !== 0) errs.push(`npm exited ${r.status}`);
  if (j.invalid?.length) errs.push(`invalid: ${j.invalid.map((x) => `${x.name}@${x.version}`).join(', ')}`);
  if (j.missing?.length) errs.push(`missing: ${j.missing.map((x) => `${x.name}@${x.version}`).join(', ')}`);
  for (const [name, pin] of Object.entries(PINNED)) {
    const v = (j.verified || []).find((x) => x.name === name && x.location === `node_modules/${name}`);
    if (!v) { errs.push(`${name}: not in verified list`); continue; }
    const slsa = (v.attestationBundles || []).find((b) => b.predicateType === 'https://slsa.dev/provenance/v1');
    if (!slsa) { errs.push(`${name}: no SLSA provenance attestation`); continue; }
    // npm has verified the sigstore bundle; read the signed in-toto statement it covers.
    const st = JSON.parse(Buffer.from(slsa.bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
    const digest = st.subject?.[0]?.digest?.sha512;
    const want = Buffer.from(pin.integrity.slice(7), 'base64').toString('hex');
    if (digest !== want) errs.push(`${name}: provenance subject digest != pinned integrity`);
    const bd = st.predicate?.buildDefinition;
    const wf = bd?.externalParameters?.workflow;
    const dep = bd?.resolvedDependencies?.[0];
    if (wf?.repository !== `https://github.com/${pin.repo}`) errs.push(`${name}: provenance repo ${wf?.repository}`);
    if (wf?.ref !== `refs/tags/${pin.version}`) errs.push(`${name}: provenance ref ${wf?.ref}`);
    if (wf?.path !== '.github/workflows/release.yml') errs.push(`${name}: provenance workflow ${wf?.path}`);
    if (dep?.digest?.gitCommit !== pin.commit) errs.push(`${name}: provenance commit ${dep?.digest?.gitCommit} != ${pin.commit}`);
    if (st.predicate?.runDetails?.builder?.id !== 'https://github.com/actions/runner/github-hosted')
      errs.push(`${name}: builder ${st.predicate?.runDetails?.builder?.id}`);
  }
  const total = (j.verified || []).length;
  if (errs.length) fail('npm audit signatures', errs.join('\n'));
  else ok('npm audit signatures', `${total} packages verified (signatures + attestations); runtime provenance repo/tag/commit/digest match pinned`);
}

// 3. Static scan ------------------------------------------------------------------------------
function checkScan() {
  const hits = [];
  const declared = {};
  for (const name of Object.keys(PINNED)) {
    const dir = join(NM, name);
    const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    declared[name] = Object.keys(pj.dependencies || {});
    for (const f of walk(dir)) {
      if (f.symlink) continue;
      const rel = `${name}/${relative(dir, f.p).split(sep).join('/')}`;
      const text = readFileSync(f.p, 'utf8');
      const prose = PROSE.test(rel);
      const code = CODE_EXT.test(rel);
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        for (const r of RULES) {
          if ((prose || !code) && !UNICODE_RULES.has(r.id)) continue;
          if (r.id === 'non-ascii' && !RUNTIME_EXT.test(rel)) continue;
          if (r.re.test(line)) hits.push({ rule: r.id, hard: !!r.hard, file: rel, line: i + 1, text: line });
        }
        // Import specifiers must be relative or one of the package's declared dependencies.
        if (code && !prose) {
          const re = /(?:\bfrom\s*|(?<![\w$.])import\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;
          for (const m of line.matchAll(re)) {
            const spec = m[2];
            if (spec.startsWith('./') || spec.startsWith('../')) continue;
            // own name (self-references in JSDoc examples) or a declared dependency
            if ([name, ...declared[name]].some((d) => spec === d || spec.startsWith(`${d}/`))) continue;
            hits.push({ rule: 'import-spec', hard: false, file: rel, line: i + 1, text: line });
          }
        }
      });
      // Blobs that decode to mostly printable text are a red flag regardless of the allowlist.
      for (const [i, line] of lines.entries()) {
        for (const m of line.matchAll(/[A-Za-z0-9+/_-]{64,}={0,2}/g)) {
          const s = m[0];
          const bytes = /^(?:0x)?[0-9a-fA-F]+$/.test(s) && s.replace(/^0x/, '').length % 2 === 0
            ? Buffer.from(s.replace(/^0x/, ''), 'hex')
            : Buffer.from(s, 'base64');
          const printable = bytes.filter((b) => (b >= 0x20 && b < 0x7f) || b === 10 || b === 9).length;
          // The base-N alphabets themselves (e.g. base64 alphabet) are expected; they are in ALLOW
          // under `blob`. This rule only fires for long payloads that decode to readable text.
          if (bytes.length >= 48 && printable / bytes.length > 0.9)
            hits.push({ rule: 'blob-decodes-to-text', hard: true, file: rel, line: i + 1, text: line });
        }
      }
    }
  }

  // Match against allowlist.
  const used = new Map(); // key rule|file -> count of hits seen
  const unexpected = [];
  const perFile = {};
  const groups = new Map();
  for (const h of hits) {
    const k = `${h.rule}|${h.file}`;
    perFile[k] = (perFile[k] || 0) + 1;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(h);
  }
  const fpOf = (hs) => sha256(hs.map((h) => `${h.line}\t${h.text}`).join('\n')).slice(0, 16);
  const fps = {};
  for (const [k, hs] of groups) {
    fps[k] = fpOf(hs);
    if (FP[k] !== fps[k]) for (const h of hs) h.changed = true;
  }
  for (const h of hits) {
    const a = ALLOW[h.rule]?.[h.file];
    h.allowed = !!a && (a.lines ? a.lines.includes(h.line) : a.count === perFile[`${h.rule}|${h.file}`]);
    h.why = a?.why;
    if (h.hard && !a?.lines) h.allowed = false; // hard rules can only be allowlisted line by line
    if (h.allowed && h.changed) { h.allowed = false; h.note = 'content differs from the reviewed fingerprint'; }
    if (h.allowed) used.set(`${h.rule}|${h.file}|${h.line}`, true);
    else unexpected.push(h);
  }
  const stale = [];
  for (const k of Object.keys(FP)) if (!groups.has(k)) stale.push(`fingerprint ${k}: no hits any more`);
  for (const [rule, files] of Object.entries(ALLOW))
    for (const [file, a] of Object.entries(files)) {
      const k = `${rule}|${file}`;
      if (groups.has(k) && fps[k] !== FP[k]) continue; // already reported as changed content
      if (a.lines) {
        for (const l of a.lines) if (!used.has(`${rule}|${file}|${l}`)) stale.push(`${rule} ${file}:${l}`);
      } else if (perFile[`${rule}|${file}`] !== a.count)
        stale.push(`${rule} ${file}: expected ${a.count} hits, found ${perFile[`${rule}|${file}`] || 0}`);
    }

  if (LIST) {
    console.log('\n--- all scan hits (ok = allowlisted, NEW = not reviewed, CHG = fingerprint changed) ---');
    for (const h of hits)
      console.log(`${h.allowed ? 'ok  ' : h.changed && ALLOW[h.rule]?.[h.file] ? 'CHG ' : 'NEW '} [${h.rule}] ${h.file}:${h.line}: ${h.text.trim().slice(0, 160)}`);
    console.log('\n--- current fingerprints (paste into FP only after reviewing every hit above) ---');
    for (const k of Object.keys(fps).sort()) console.log(`  '${k}': '${fps[k]}',`);
  }
  const counts = {};
  for (const h of hits) counts[h.rule] = (counts[h.rule] || 0) + 1;
  const summary = Object.entries(counts).map(([r, c]) => `${r}=${c}`).join(' ');
  const errs = [];
  for (const h of unexpected.slice(0, 50))
    errs.push(`${h.hard ? 'HARD ' : ''}[${h.rule}] ${h.file}:${h.line}: ${h.text.trim().slice(0, 140)}${h.note ? ` (${h.note})` : ''}`);
  if (unexpected.length > 50) errs.push(`... and ${unexpected.length - 50} more (run with --list)`);
  for (const s of stale) errs.push(`stale allowlist entry: ${s}`);
  if (errs.length) fail('static scan', `${unexpected.length} unreviewed hit(s), ${stale.length} stale entr(ies)\n${errs.join('\n')}`);
  else ok('static scan', `${hits.length} hits, all on the reviewed allowlist (${summary})`);
}

// ---------------------------------------------------------------------------------------------
const trees = {};
checkLockfile();
checkInstalled(trees);
checkSignatures();
checkScan();

if (LIST) {
  console.log('\n--- computed file-tree hashes ---');
  for (const [n, t] of Object.entries(trees)) console.log(`${n}: ${t.tree} (${t.files} files)`);
}
console.log(`\nDependency audit (${Object.keys(PINNED).length} runtime packages)`);
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `: ${r.pass ? r.detail : ''}` : ''}`);
  if (!r.pass) console.log(r.detail.split('\n').map((l) => `      ${l}`).join('\n'));
}
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
