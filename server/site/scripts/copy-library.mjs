// Copies the built library (tau-crypto/dist) into the site, fresh on every
// build, so the app needs nothing outside its folder (OpenNext requires that):
//   lib/tau-crypto/     what pages import ('tau-crypto/wallet', see jsconfig.json)
//   public/tau-crypto/  the miner, served as static files and loaded by the mine
//                       page at run time, so the WASM stays out of the bundles
//                       (and out of the server Worker on Cloudflare)
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../../../tau-crypto/dist/', import.meta.url));
if (!existsSync(`${from}index.js`)) throw new Error(`no built library at ${from}: run tau-crypto/dev build`);
const keep = (src) => !src.includes('/types') && !src.endsWith('/cli.js');
for (const dir of ['../lib/tau-crypto/', '../public/tau-crypto/']) {
  const to = fileURLToPath(new URL(dir, import.meta.url));
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, filter: keep });
}
console.log('copied tau-crypto/dist into lib/tau-crypto and public/tau-crypto');
