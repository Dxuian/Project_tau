import { readFileSync, writeFileSync } from 'node:fs';
// Generator for the unrolled scanner section of src/backends/js.ts (pass32,
// scanRange). Rewrites everything below the GENERATED marker in place.
// Run in the dev container: ./dev shell node scripts/gen-sha256-js.mjs
// (the script reads and writes /src/src/backends/js.ts).

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const u32 = (x) => x >>> 0;
const hex = (x) => '0x' + u32(x).toString(16).padStart(8, '0');
const crotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
const cS0 = (x) => u32(crotr(x, 2) ^ crotr(x, 13) ^ crotr(x, 22));
const cS1 = (x) => u32(crotr(x, 6) ^ crotr(x, 11) ^ crotr(x, 25));
const cs0 = (x) => u32(crotr(x, 7) ^ crotr(x, 18) ^ (x >>> 3));
const cs1 = (x) => u32(crotr(x, 17) ^ crotr(x, 19) ^ (x >>> 10));

const isC = (v) => typeof v === 'number';
const lit = (v) => (isC(v) ? hex(v) : v);
const ror = (v, n) => `(${v} >>> ${n} | ${v} << ${32 - n})`;
const S0 = (v) => (isC(v) ? cS0(v) : `(${ror(v, 2)} ^ ${ror(v, 13)} ^ ${ror(v, 22)})`);
const S1 = (v) => (isC(v) ? cS1(v) : `(${ror(v, 6)} ^ ${ror(v, 11)} ^ ${ror(v, 25)})`);
const s0 = (v) => (isC(v) ? cs0(v) : `(${ror(v, 7)} ^ ${ror(v, 18)} ^ (${v} >>> 3))`);
const s1 = (v) => (isC(v) ? cs1(v) : `(${ror(v, 17)} ^ ${ror(v, 19)} ^ (${v} >>> 10))`);
const xor = (p, q) => {
  if (isC(p) && isC(q)) return u32(p ^ q);
  if (p === 0) return q;
  if (q === 0) return p;
  return `(${lit(p)} ^ ${lit(q)})`;
};
const and = (p, q) => {
  if (isC(p) && isC(q)) return u32(p & q);
  if (p === 0 || q === 0) return 0;
  return `(${lit(p)} & ${lit(q)})`;
};
const ch = (e, f, g) => xor(g, and(e, xor(f, g)));

// Sum of terms (numbers fold into one constant, placed where the first
// constant appears so early-available terms are added first).
function sum(terms) {
  let c = 0;
  let at = -1;
  let vars = 0;
  const parts = [];
  for (const t of terms) {
    if (isC(t)) {
      if (at < 0) {
        at = parts.length;
        parts.push(null);
      }
      c = u32(c + t);
    } else {
      parts.push(t);
      vars++;
    }
  }
  if (vars === 0) return c;
  if (at >= 0) {
    if (c === 0) parts.splice(at, 1);
    else parts[at] = hex(c);
  }
  if (parts.length === 1) return { one: parts[0] };
  return { many: parts.join(' + ') };
}
const wrap = (s) => (isC(s) ? hex(s) : s.one !== undefined ? s.one : `(${s.many}) | 0`);

const NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

class Gen {
  constructor(indent) {
    this.ind = indent;
    this.lines = [];
    this.val = {}; // var name -> constant or alias currently standing for it
    this.prevX = null; // a ^ b of the previous round (Maj reuse)
    this.xi = 0;
    this.W = [];
  }
  emit(s) {
    this.lines.push(this.ind + s);
  }
  comment(s) {
    this.lines.push(this.ind + '// ' + s);
  }
  get(name) {
    return name in this.val ? this.val[name] : name;
  }
  assign(name, s) {
    if (isC(s)) {
      this.val[name] = s;
      return;
    }
    delete this.val[name];
    this.emit(`${name} = ${wrap(s)};`);
  }
  // Working variable j (0 = a .. 7 = h) during round r.
  role(j, r) {
    return NAMES[(j - r) & 7];
  }
  // Starts a compression at round r with values for a..h: a constant, the
  // name of a local standing for it, or null if its letter already holds it.
  start(r, values, prevX) {
    this.val = {};
    for (let j = 0; j < 8; j++) {
      if (values[j] !== null) this.val[this.role(j, r)] = values[j];
    }
    this.prevX = prevX ?? xor(values[1], values[2]);
    this.xi = 0;
  }
  round(r, kw, eOnly = false) {
    const N = (j) => this.role(j, r);
    const v = (j) => this.get(N(j));
    const a = v(0), b = v(1), d = v(3), e = v(4), f = v(5), g = v(6), h = v(7);
    const t1 = sum([h, ...kw, ch(e, f, g), S1(e)]);
    let T = t1;
    if (!isC(t1)) {
      this.emit(`t = ${wrap(t1)};`);
      T = 't';
    }
    this.assign(N(3), sum([d, T]));
    if (eOnly) return;
    const X = xor(a, b);
    let Xn = X;
    if (!isC(X)) {
      Xn = this.xi ? 'y' : 'x';
      this.xi ^= 1;
      this.emit(`${Xn} = ${X};`);
    }
    const maj = xor(b, and(Xn, this.prevX));
    this.prevX = Xn;
    this.assign(N(7), sum([S0(a), maj, T]));
  }
  // K + W terms for round r with message word W[r].
  kw(r) {
    const w = this.W[r];
    return isC(w) ? [u32(K[r] + w)] : [K[r], w];
  }
  // Generic zero-aware message expansion of W[t].
  sched(t) {
    const W = this.W;
    const s = sum([W[t - 16], W[t - 7], s0(W[t - 15]), s1(W[t - 2])]);
    if (isC(s)) {
      W[t] = s;
      return;
    }
    const name = `w${t & 15}`;
    this.emit(`${name} = ${wrap(s)};`);
    W[t] = name;
  }
  setW(t, s) {
    const name = `w${t & 15}`;
    this.emit(`${name} = ${wrap(s)};`);
    this.W[t] = name;
  }
}

// Block 1 (header bytes 64..79): rounds 4..63 from the precomputed state.
// Expects locals sa..sh (state at round 4 without the nonce), x0..x6, kx16,
// kx17, bc (= sb ^ sc), m0..m7 (midstate) and w3 = nonce.
function block1(g) {
  g.comment('Block 1: finish round 3 with the nonce, then rounds 4..63.');
  g.emit(`${g.role(0, 4)} = (sa + w3) | 0;`);
  g.emit(`${g.role(4, 4)} = (se + w3) | 0;`);
  g.start(4, [null, 'sb', 'sc', 'sd', null, 'sf', 'sg', 'sh'], 'bc');
  const W = (g.W = []);
  W[3] = 'w3';
  W[4] = 0x80000000;
  for (let i = 5; i < 15; i++) W[i] = 0;
  W[15] = 640;
  for (let r = 4; r < 16; r++) g.round(r, g.kw(r));
  g.comment('W16..W32 from the precomputed terms (upstream sha256_4x32_final_rounds).');
  W[16] = 'x0';
  W[17] = 'x1';
  g.round(16, ['kx16']);
  g.round(17, ['kx17']);
  const plan = [
    [18, ['x2', s0('w3')]],
    [19, ['x3', 'w3']],
    [20, [0x80000000, s1('w2')]],
    [21, [s1('w3')]],
    [22, [640, s1('w4')]],
    [23, ['x0', s1('w5')]],
    [24, ['x1', s1('w6')]],
    [25, ['w2', s1('w7')]],
    [26, ['w3', s1('w8')]],
    [27, ['w4', s1('w9')]],
    [28, ['w5', s1('w10')]],
    [29, ['w6', s1('w11')]],
    [30, ['x4', 'w7', s1('w12')]],
    [31, ['x5', 'w8', s1('w13')]],
    [32, ['x6', 'w9', s1('w14')]],
  ];
  for (const [t, terms] of plan) {
    g.setW(t, sum(terms));
    g.round(t, g.kw(t));
  }
  for (let r = 33; r < 64; r++) {
    g.sched(r);
    g.round(r, g.kw(r));
  }
  g.comment('First digest = midstate + state; it is the next message (words 0..7).');
  for (let j = 0; j < 8; j++) g.emit(`w${j} = (m${j} + ${g.get(g.role(j, 64))}) | 0;`);
}

// 32-byte message in w0..w7 (padded: W8 = 0x80000000, W9..14 = 0, W15 = 256)
// from the IV. full: all 64 rounds and the digest back into w0..w7;
// otherwise rounds 0..60 (57..60 only for e), leaving final word 7 - IV7 in
// the returned letter.
function block32(g, full) {
  g.start(0, IV.slice());
  const W = (g.W = []);
  for (let i = 0; i < 8; i++) W[i] = `w${i}`;
  W[8] = 0x80000000;
  for (let i = 9; i < 15; i++) W[i] = 0;
  W[15] = 256;
  for (let r = 0; r < 16; r++) g.round(r, g.kw(r));
  const last = full ? 64 : 61;
  for (let r = 16; r < last; r++) {
    g.sched(r);
    g.round(r, g.kw(r), !full && r >= 57);
  }
  if (full) {
    for (let j = 0; j < 8; j++) g.emit(`w${j} = (${g.get(g.role(j, 64))} + ${hex(IV[j])}) | 0;`);
    return null;
  }
  // e of round 60 is the final h (word 7) before adding the IV.
  return g.role(3, 60);
}


const FILE = '/src/src/backends/js.ts';
const MARK = '// GENERATED BELOW (fully unrolled; regenerate instead of editing by hand)';

const LOCALS = (ind, w07) => [
  `${ind}let a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0, t = 0, x = 0, y = 0;`,
  `${ind}let ${w07};`,
  `${ind}let w8 = 0, w9 = 0, w10 = 0, w11 = 0, w12 = 0, w13 = 0, w14 = 0, w15 = 0;`,
];

function genPass() {
  const out = [
    '/** One SHA-256 pass over the 32-byte message io[0..7] (from the IV); the digest replaces it. */',
    'function pass32(io: Int32Array): void {',
    ...LOCALS('  ', 'w0 = io[0], w1 = io[1], w2 = io[2], w3 = io[3], w4 = io[4], w5 = io[5], w6 = io[6], w7 = io[7]'),
  ];
  const g = new Gen('  ');
  block32(g, true);
  out.push(...g.lines);
  out.push('  io[0] = w0;', '  io[1] = w1;', '  io[2] = w2;', '  io[3] = w3;');
  out.push('  io[4] = w4;', '  io[5] = w5;', '  io[6] = w6;', '  io[7] = w7;');
  out.push('}');
  return out;
}

function genScan() {
  const out = [
    '/**',
    ' * Scans nonces [n, end) and returns the first whose final hash word 7 is at',
    ' * most target[7], or -1. extra: SHA-256 passes between block 1 and the final',
    ' * one (0 sha256d, 1 sha256t, 2 sha256q). p: midstate (0..7), block-1 a..h at',
    ' * round 4 without the nonce (8..15), X0..X6 (16..22), target[7] ^ 0x80000000',
    ' * (23). io: scratch for the extra passes.',
    ' */',
    'function scanRange(p: Int32Array, n: number, end: number, extra: number, io: Int32Array): number {',
    '  const m0 = p[0], m1 = p[1], m2 = p[2], m3 = p[3], m4 = p[4], m5 = p[5], m6 = p[6], m7 = p[7];',
    '  const sa = p[8], sb = p[9], sc = p[10], sd = p[11], se = p[12], sf = p[13], sg = p[14], sh = p[15];',
    '  const x0 = p[16], x1 = p[17], x2 = p[18], x3 = p[19], x4 = p[20], x5 = p[21], x6 = p[22];',
    '  const t7 = p[23];',
    `  const kx16 = (x0 + ${hex(K[16])}) | 0, kx17 = (x1 + ${hex(K[17])}) | 0, bc = sb ^ sc;`,
    ...LOCALS('  ', 'w0 = 0, w1 = 0, w2 = 0, w3 = 0, w4 = 0, w5 = 0, w6 = 0, w7 = 0'),
    '  for (; n < end; n++) {',
    '    w3 = n | 0;',
  ];
  const g = new Gen('    ');
  block1(g);
  out.push(...g.lines);
  out.push(
    '    if (extra > 0) {',
    '      io[0] = w0;',
    '      io[1] = w1;',
    '      io[2] = w2;',
    '      io[3] = w3;',
    '      io[4] = w4;',
    '      io[5] = w5;',
    '      io[6] = w6;',
    '      io[7] = w7;',
    '      for (let i = 0; i < extra; i++) pass32(io);',
    '      w0 = io[0];',
    '      w1 = io[1];',
    '      w2 = io[2];',
    '      w3 = io[3];',
    '      w4 = io[4];',
    '      w5 = io[5];',
    '      w6 = io[6];',
    '      w7 = io[7];',
    '    }',
  );
  const gc = new Gen('    ');
  gc.comment('Final pass to round 60; rounds 57..60 only need e.');
  const e60 = block32(gc, false);
  out.push(...gc.lines);
  out.push(
    `    t = (${e60} + ${hex(IV[7])}) | 0; // big-endian final word 7`,
    '    if ((((t << 24) | ((t & 0xff00) << 8) | ((t >>> 8) & 0xff00) | (t >>> 24)) ^ 0x80000000) <= t7) return n;',
    '  }',
    '  return -1;',
    '}',
  );
  return out;
}

const head = readFileSync(FILE, 'utf8');
const at = head.indexOf(MARK);
if (at < 0) throw new Error('marker not found');
const body = [
  MARK,
  '//',
  '// Notation: in round r, working variable j (a = 0 .. h = 7) lives in letter',
  '// (j - r) mod 8, so a round writes two locals only (the new e into the letter',
  "// holding d, the new a into h's) and the letters line up again every 8 rounds.",
  '// t is T1; x and y alternately hold a ^ b of this and the previous round, so',
  '// Maj(a, b, c) = b ^ ((a ^ b) & (b ^ c)) costs one new xor. w0..w15 are the',
  '// message schedule window (W[t] in w(t mod 16)). Constant message words',
  '// (padding, lengths) and IV-only terms are folded into the literals.',
  '',
  ...genPass(),
  '',
  ...genScan(),
  '',
].join('\n');
writeFileSync(FILE, head.slice(0, at) + body);
console.log('wrote', FILE, (head.slice(0, at) + body).split('\n').length, 'lines');
