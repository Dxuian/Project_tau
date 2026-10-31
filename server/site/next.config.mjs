// The library is copied into lib/tau-crypto at build time (scripts/copy-library.mjs),
// so the app is self-contained: the defaults for the bundler and file tracing apply.

/** @type {import('next').NextConfig} */
export default {
  poweredByHeader: false,
  images: { unoptimized: true },
};
