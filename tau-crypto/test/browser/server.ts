// Helpers for the headless-browser tests: a tiny static file server on
// 127.0.0.1 and esbuild bundling of browser entries.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { build } from 'esbuild';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};

export interface StaticServer {
  /** Base URL, ending in '/'. */
  url: string;
  close(): Promise<void>;
}

/**
 * Serves files under `root`, plus in-memory `files` (URL path -> content),
 * on 127.0.0.1 at a free port. `/` maps to `/index.html`.
 */
export async function serve(root: string, files: Record<string, string> = {}): Promise<StaticServer> {
  const base = normalize(root + sep);
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const name = path === '/' ? '/index.html' : path;
    const type = TYPES[extname(name)] ?? 'application/octet-stream';
    try {
      let body: string | Uint8Array;
      if (name in files) body = files[name];
      else {
        const file = normalize(join(base, name));
        if (!file.startsWith(base)) throw new Error('outside root');
        body = await readFile(file);
      }
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server has no port');
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Bundles a browser entry (TypeScript allowed) into one ES module at `outfile`. */
export async function bundle(entry: string, outfile: string): Promise<string> {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: 'inline',
    logLevel: 'silent',
  });
  return outfile;
}

/** A page that loads `script` as a module and sets window.__ready (or __error). */
export function modulePage(script: string): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>tau-crypto test</title>
<script type="module">
  import(${JSON.stringify(script)}).then(
    () => { window.__ready = true; },
    (e) => { window.__error = String(e && e.stack || e); },
  );
</script>
`;
}
