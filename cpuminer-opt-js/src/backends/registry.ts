// Backend registry. Each backend declares which algorithms it supports in a
// given environment and how to create a Kernel. Kernels are created inside
// workers (CPU backends) or on the main thread (GPU, inline fallback).
import type { AlgoSpec, BackendName, Capabilities, Kernel, KernelSetup } from '../types.ts';

export interface BackendFactory {
  readonly name: BackendName;
  readonly kind: 'cpu' | 'gpu';
  /** Lower runs first in quick mode when nothing has been measured. */
  readonly priority: number;
  /** null if usable, otherwise the reason it isn't (shown in tune results). */
  unsupported(algo: AlgoSpec, caps: Capabilities): string | null;
  create(setup: KernelSetup): Promise<Kernel>;
}

const factories = new Map<BackendName, BackendFactory>();

export function registerBackend(factory: BackendFactory): void {
  factories.set(factory.name, factory);
}

export function getBackend(name: BackendName): BackendFactory {
  const f = factories.get(name);
  if (!f) throw new Error(`unknown backend ${name}`);
  return f;
}

export function listBackends(): BackendFactory[] {
  return [...factories.values()].sort((a, b) => a.priority - b.priority);
}

/** Algorithms the hand-written sha256 kernels implement (js, node-crypto, wasm-sha256-*, webgpu). */
export const SHA256_FAMILY = new Set(['sha256d', 'sha256t', 'sha256q']);
