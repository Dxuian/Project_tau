// Copies the built library (tau-crypto/dist) into the site, fresh on every
// build, so the app needs nothing outside its folder (OpenNext requires that):
//   lib/tau-crypto/     what pages and server code import ('tau-crypto/wallet', see
//                       jsconfig.json), as built: Next.js bundles and minifies what
//                       the pages use
//   public/tau-crypto/  the miner, served as static files and loaded by the mine
//                       page at run time, so the WASM stays out of the bundles
//                       (and out of the server Worker on Cloudflare). Only the files
//                       the miner loads (index.js and the chunks it imports, at once
//                       or lazily), minified with esbuild, the mining worker's
//                       inlined source too, each with a source map. The WASM inside
//                       is data, so it's unchanged: hashing is exactly the same.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { transform } from 'esbuild';

const from = fileURLToPath(new URL('../../../tau-crypto/dist/', import.meta.url));
if (!existsSync(`${from}index.js`)) throw new Error(`no built library at ${from}: run tau-crypto/dev build`);

const lib = fileURLToPath(new URL('../lib/tau-crypto/', import.meta.url));
rmSync(lib, { recursive: true, force: true });
cpSync(from, lib, { recursive: true, filter: (src) => !src.includes('/types') && !src.endsWith('/cli.js') });

/** index.js and every chunk it imports, statically or with import(), as paths relative to dist/. */
function minerFiles() {
  const found = new Set();
  const visit = (file) => {
    if (found.has(file)) return;
    found.add(file);
    const code = readFileSync(join(from, file), 'utf8');
    for (const [, spec] of code.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+\.js)["']/g)) visit(relative(from, join(from, dirname(file), spec)));
  };
  visit('index.js');
  return [...found].sort();
}

// The mining worker: built by the library as one script and inlined as a string
// literal (tau-crypto/scripts/build.mjs). The literal is read as a value, the script
// minified, and put back as a string.
const WORKER = /var WORKER_SOURCE = ('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*");/g;
const minify = { minify: true, target: 'es2022', legalComments: 'eof' };
async function minifyWorker(code, file) {
  const found = [...code.matchAll(WORKER)];
  if (!found.length) return { code, worker: null };
  if (found.length > 1) throw new Error(`${file}: more than one WORKER_SOURCE`);
  const source = vm.runInNewContext(`(${found[0][1]})`, {}); // a string literal, nothing else
  if (typeof source !== 'string' || !source.length) throw new Error(`${file}: WORKER_SOURCE isn't a string`);
  const small = (await transform(source, { ...minify, loader: 'js' })).code;
  return { code: code.replace(found[0][0], () => `var WORKER_SOURCE = ${JSON.stringify(small)};`), worker: { from: source.length, to: small.length } };
}

const pub = fileURLToPath(new URL('../public/tau-crypto/', import.meta.url));
rmSync(pub, { recursive: true, force: true });
let before = 0;
let after = 0;
let workers = 0;
for (const file of minerFiles()) {
  const original = readFileSync(join(from, file), 'utf8');
  const { code, worker } = await minifyWorker(original, file);
  if (worker) workers++;
  const name = file.split('/').pop();
  const out = await transform(code, { ...minify, loader: 'js', format: 'esm', sourcemap: 'external', sourcefile: name });
  mkdirSync(dirname(join(pub, file)), { recursive: true });
  writeFileSync(join(pub, file), `${out.code}//# sourceMappingURL=${name}.map\n`);
  writeFileSync(join(pub, `${file}.map`), out.map);
  before += original.length;
  after += out.code.length;
}
if (workers !== 1) throw new Error(`expected the mining worker's source in one chunk, found ${workers}`);
console.log(`copied tau-crypto/dist into lib/tau-crypto; the miner into public/tau-crypto, minified: ${(before / 1024).toFixed(0)} KiB -> ${(after / 1024).toFixed(0)} KiB`);
