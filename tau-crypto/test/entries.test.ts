// The package's entries, as an app (Next.js, Cloudflare Pages, Node) uses them:
// the server/edge entries load no Node built-ins and no embedded WASM, the
// library holds no platform (Cloudflare) code, and every export resolves by
// package name from node_modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { ROOT } from './helpers.ts';

const DIST = join(ROOT, 'dist');
const BUILT = existsSync(join(DIST, 'bridge.js'));
const skip = !BUILT && 'run ./dev build first';
const PLATFORM_NAMES = /WebSocketPair|cloudflare:|cf-connecting-ip/;

/** Every file `entry` loads, statically or dynamically, and the specifiers that aren't files. */
function importGraph(entry: string): { files: string[]; external: string[] } {
  const files = new Set<string>();
  const external = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const code = readFileSync(file, 'utf8');
    // esbuild's import/export statements start a line; dynamic imports may be anywhere.
    const statements = /^(?:import|export)\b[^;]*?\bfrom\s*"([^"\n]+)"|^import\s*"([^"\n]+)"|\bimport\(\s*"([^"\n]+)"\s*\)/gm;
    for (const m of code.matchAll(statements)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith('./') || spec.startsWith('../')) visit(resolve(dirname(file), spec));
      else external.add(spec);
    }
  };
  visit(join(DIST, entry));
  return { files: [...files], external: [...external] };
}

test('the import walk follows static and lazy imports (the miner entry reaches the WASM)', { skip }, () => {
  const { files, external } = importGraph('index.js');
  assert.deepEqual(external, []);
  assert.ok(files.length > 3, `${files.length} files`);
  assert.ok(files.some((f) => readFileSync(f, 'utf8').includes('gzipBase64')));
  assert.ok(importGraph('wallet.js').files.length > 1, 'wallet.js loads its shared chunk');
});

for (const entry of ['wallet.js', 'payouts.js', 'bridge.js']) {
  test(`dist/${entry} runs on servers and edge runtimes: no Node built-ins, no WASM, no platform code`, { skip }, () => {
    const { files, external } = importGraph(entry);
    assert.deepEqual(external, [], 'everything is bundled');
    for (const file of files) {
      const code = readFileSync(file, 'utf8');
      const name = relative(DIST, file);
      assert.ok(!code.includes('gzipBase64'), `${name} carries the embedded WASM`);
      assert.ok(!PLATFORM_NAMES.test(code), `${name} has platform-specific code`);
    }
  });
}

test('the library holds no Cloudflare-specific code (src/ and dist/)', { skip }, () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const offenders = [...walk(join(ROOT, 'src')), ...walk(DIST)]
    .filter((f) => /\.(ts|js)$/.test(f))
    .filter((f) => PLATFORM_NAMES.test(readFileSync(f, 'utf8')))
    .map((f) => relative(ROOT, f));
  assert.deepEqual(offenders, []);
});

test('every package export resolves by name from node_modules', { skip }, () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const [subpath, target] of Object.entries<{ types: string; default: string }>(pkg.exports)) {
    assert.ok(existsSync(join(ROOT, target.default)), `${subpath}: ${target.default}`);
    assert.ok(existsSync(join(ROOT, target.types)), `${subpath}: ${target.types}`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'tau-entries-'));
  try {
    const home = join(dir, 'node_modules', 'tau-crypto');
    mkdirSync(home, { recursive: true });
    cpSync(DIST, join(home, 'dist'), { recursive: true });
    writeFileSync(join(home, 'package.json'), JSON.stringify(pkg));
    writeFileSync(
      join(dir, 'check.mjs'),
      `const names = {
  'tau-crypto': ['mineBTC', 'createMiner', 'detect', 'hash'],
  'tau-crypto/wallet': ['createWallet', 'newAddress', 'walletFromMnemonic', 'payout', 'esplora'],
  'tau-crypto/payouts': ['createPayoutService', 'createShareAuditor', 'verifyPayout', 'memoryStores'],
  'tau-crypto/bridge': ['createFetchBridge', 'poolTarget', 'BRIDGE_FEATURES'],
  'tau-crypto/bridge/node': ['createBridge', 'runBridgeCli', 'poolTarget'],
};
const out = {};
for (const [spec, wanted] of Object.entries(names)) {
  const m = await import(spec);
  out[spec] = wanted.filter((n) => !(n in m));
}
console.log(JSON.stringify(out));
`,
    );
    const missing = JSON.parse(execFileSync(process.execPath, ['check.mjs'], { cwd: dir, encoding: 'utf8' }).trim().split('\n').pop()!);
    for (const [spec, names] of Object.entries(missing)) assert.deepEqual(names, [], spec);
    assert.deepEqual(Object.keys(missing).sort(), Object.keys(pkg.exports).map((s: string) => (s === '.' ? 'tau-crypto' : `tau-crypto/${s.slice(2)}`)).sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
