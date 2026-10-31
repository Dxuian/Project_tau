// Stratum entry point: picks the transport for the runtime and builds the client.
import { detectRuntime } from '../env/detect.ts';
import type { RuntimeName, StratumClient, TransportFactory } from '../types.ts';
import { StratumClientImpl, type StratumClientOptions } from './client.ts';
import { nodeTransport } from './transport-node.ts';
import { wsTransport } from './transport-ws.ts';

export {
  DEFAULT_USER_AGENT,
  LineDecoder,
  MAX_LINE_BYTES,
  StratumClientImpl,
  formatHostPort,
  formatStratumUrl,
  parseStratumUrl,
} from './client.ts';
export type { StratumClientOptions, StratumScheme, StratumTuning, StratumUrl } from './client.ts';
export { NodeTransport, nodeTransport, type NodeTransportOptions } from './transport-node.ts';
export { WsTransport, bridgeUrl, wsTransport, type WsTransportOptions } from './transport-ws.ts';

/**
 * The transport used when none is given: WebSocket to `bridge` if set, else
 * TCP/TLS where node:net exists (Node, Deno, Bun). Browsers need a bridge.
 */
export function defaultTransport(
  options: Pick<StratumClientOptions, 'bridge' | 'tlsInsecure' | 'connectTimeoutMs'>,
  runtime: RuntimeName = detectRuntime(),
): TransportFactory {
  if (options.bridge) return wsTransport({ bridge: options.bridge, connectTimeoutMs: options.connectTimeoutMs });
  if (runtime === 'node' || runtime === 'deno' || runtime === 'bun') {
    return nodeTransport({ tlsInsecure: options.tlsInsecure, connectTimeoutMs: options.connectTimeoutMs });
  }
  throw new Error(
    'browsers cannot open TCP connections to a stratum pool: run a bridge ' +
      '(tau-crypto bridge --listen 8080 --allow pool.example.com:3333) and pass its URL as `bridge`, ' +
      'e.g. bridge: "ws://localhost:8080"',
  );
}

/** Builds a client; call connect() to subscribe and authorize. Throws on an invalid URL. */
export function createStratumClient(options: StratumClientOptions): StratumClient {
  return new StratumClientImpl({ ...options, transport: options.transport ?? defaultTransport(options) });
}
