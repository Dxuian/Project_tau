// Algorithm registry: names and aliases from the vendored C sources, plus what
// this library knows about each one (status, which backends apply).
import { ALGO_ALIASES, ALGO_NAMES } from './algos.generated.ts';
import type { AlgoSpec } from './types.ts';

export type AlgoStatus = 'ok' | 'node-only' | 'needs-params' | 'unsupported-upstream';

export interface AlgoInfo {
  name: string;
  /** cpuminer-opt enum algos value. */
  id: number;
  aliases: string[];
  status: AlgoStatus;
  notes?: string;
  /** Has hand-written kernels (js, node-crypto, wasm-sha256-*, webgpu). */
  sha256Family: boolean;
}

const STATUS: Record<string, { status: AlgoStatus; notes: string }> = {
  bmw: {
    status: 'unsupported-upstream',
    notes: 'cpuminer-opt v26.1 lists bmw but never registers it (no register_gate case).',
  },
  verthash: {
    status: 'node-only',
    notes: 'Needs the 1.28 GB verthash.dat dataset per worker (generated on first use); Node only.',
  },
  'yespower-b2b': {
    status: 'needs-params',
    notes: 'Generic yespower+blake2b: pass params { n, r, key } (e.g. power2b: n=2048, r=32, key="Now I am become Death, the destroyer of worlds").',
  },
};

const SHA256_FAMILY = new Set(['sha256d', 'sha256t', 'sha256q']);

export function listAlgorithms(): AlgoInfo[] {
  const aliasesOf = new Map<string, string[]>();
  for (const [alias, proper] of Object.entries(ALGO_ALIASES)) {
    const base = proper.split(':')[0];
    aliasesOf.set(base, [...(aliasesOf.get(base) ?? []), alias]);
  }
  const out: AlgoInfo[] = [];
  ALGO_NAMES.forEach((name, id) => {
    if (!name) return;
    const s = STATUS[name];
    out.push({
      name,
      id,
      aliases: aliasesOf.get(name) ?? [],
      status: s?.status ?? 'ok',
      ...(s ? { notes: s.notes } : {}),
      sha256Family: SHA256_FAMILY.has(name),
    });
  });
  return out;
}

export interface AlgoParams {
  /** --param-n (scrypt N, yespower N...). */
  n?: number;
  /** --param-r. */
  r?: number;
  /** --param-key. */
  key?: string;
}

/**
 * Resolves a name or alias exactly like cpuminer-opt's `-a` option
 * (cpu-miner.c parse_arg): aliases first, then a case-insensitive prefix match
 * against the names, accepting "name" or "name:N" (sets N).
 */
export function resolveAlgo(nameOrAlias: string, params: AlgoParams = {}): AlgoSpec {
  let arg = nameOrAlias;
  const alias = Object.keys(ALGO_ALIASES).find((a) => a.toLowerCase() === arg.toLowerCase());
  if (alias) arg = ALGO_ALIASES[alias];

  for (let id = 1; id < ALGO_NAMES.length; id++) {
    const name = ALGO_NAMES[id];
    if (!name || arg.slice(0, name.length).toLowerCase() !== name.toLowerCase()) continue;
    const rest = arg.slice(name.length);
    let n = 0;
    if (rest === '') {
      // exact name
    } else if (rest[0] === ':' && /^\d+$/.test(rest.slice(1)) && Number(rest.slice(1)) >= 2) {
      n = Number(rest.slice(1));
    } else {
      continue;
    }
    return { name, id, paramN: params.n ?? n, paramR: params.r ?? 0, key: params.key ?? null };
  }
  throw new Error(`unknown algorithm "${nameOrAlias}" (see listAlgorithms())`);
}

export function algoInfo(name: string): AlgoInfo | undefined {
  return listAlgorithms().find((a) => a.name === name);
}
