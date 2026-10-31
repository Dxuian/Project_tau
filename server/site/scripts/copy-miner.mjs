// Copies the library's built miner (tau-crypto/dist) into public/tau-crypto/.
// The mining page loads it from there at run time, so the WASM miner is served
// as static files and stays out of the Next.js bundles (and out of the server
// Worker on Cloudflare).
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../../../tau-crypto/dist/', import.meta.url));
const to = fileURLToPath(new URL('../public/tau-crypto/', import.meta.url));
if (!existsSync(`${from}index.js`)) throw new Error(`no built library at ${from}: run tau-crypto/dev build`);
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true, filter: (src) => !src.includes('/types') && !src.endsWith('/cli.js') });
console.log(`copied the miner to ${to}`);
