// Entry point of every scan worker (Node worker_threads or a Web Worker).
// Bundled to a self-contained script string at build time (worker-source.ts).
import { ScanLoop } from './scan-loop.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

type AnyGlobal = typeof globalThis & Record<string, any>;
const g = globalThis as AnyGlobal;

// Node: process.getBuiltinModule works whether this runs as CommonJS or ESM.
const nodePort = typeof g.process?.getBuiltinModule === 'function'
  ? g.process.getBuiltinModule('node:worker_threads')?.parentPort ?? null
  : null;

const post = (msg: FromWorker): void => {
  if (nodePort) nodePort.postMessage(msg);
  else g.postMessage(msg);
};

const loop = new ScanLoop(post);
const onMessage = (msg: ToWorker): void => {
  void loop.handle(msg).then(() => {
    if (msg.type === 'dispose') {
      if (nodePort) nodePort.close();
      else g.close?.();
    }
  });
};

if (nodePort) nodePort.on('message', onMessage);
else g.onmessage = (e: MessageEvent<ToWorker>) => onMessage(e.data);
