// The library is copied into lib/tau-crypto at build time (scripts/copy-library.mjs),
// so the app is self-contained: the defaults for the bundler and file tracing apply.

/** @type {import('next').NextConfig} */
export default {
  poweredByHeader: false,
  images: { unoptimized: true },
  // Served next to the scripts, so PostHog's error tracking can read the stack
  // traces of the browser's errors. The source is public anyway (the repository).
  productionBrowserSourceMaps: true,
  // One screen now: the old pages lead to it (the address is remembered on the device, not in the URL).
  async redirects() {
    return [
      { source: '/wallet', destination: '/', permanent: false },
      { source: '/mine/:address', destination: '/', permanent: false },
    ];
  },
};
