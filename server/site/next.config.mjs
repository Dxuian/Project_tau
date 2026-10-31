// The library is two folders up (../../tau-crypto, linked into node_modules),
// so the bundler and the output file tracing work from the repository root.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @type {import('next').NextConfig} */
export default {
  turbopack: { root: repo },
  outputFileTracingRoot: repo,
  poweredByHeader: false,
  images: { unoptimized: true },
};
