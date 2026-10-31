// Bundled worker script. Replaced at build time (scripts/build.mjs) by the
// self-contained bundle of worker-entry.ts; undefined when running from
// source, in which case Node loads worker-entry.ts directly.
export const WORKER_SOURCE: string | undefined = undefined;
