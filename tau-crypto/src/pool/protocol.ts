// Messages between the main thread and scan workers (also used by the inline
// executor, which runs the same loop on the main thread).
import type { BackendName, FoundSolution, KernelSetup, ScanJob } from '../types.ts';

export type ToWorker =
  | { type: 'init'; setup: KernelSetup }
  /** Scan job.start..job.end in chunks of `chunk` nonces; replaces any current work. */
  | { type: 'work'; gen: number; job: ScanJob; chunk: number }
  | { type: 'chunk'; chunk: number }
  | { type: 'throttle'; value: number }
  | { type: 'stop' }
  /** Measure: warm up, then scan `job` for `ms` and report the rate. */
  | { type: 'bench'; job: ScanJob; warmupMs: number; ms: number }
  | { type: 'dispose' };

export type FromWorker =
  | { type: 'ready'; backend: BackendName; memoryBytes: number; granularity: number }
  | { type: 'progress'; gen: number; seq: number; hashes: number; ms: number; solutions: FoundSolution[]; cursor: number }
  | { type: 'exhausted'; gen: number; seq: number }
  | { type: 'bench'; hashes: number; ms: number; memoryBytes: number }
  | { type: 'error'; message: string; fatal: boolean };
