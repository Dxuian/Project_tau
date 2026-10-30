import type { RuntimeName, StratumClient, TransportFactory } from '../types.ts';
import { type StratumClientOptions } from './client.ts';
export { DEFAULT_USER_AGENT, LineDecoder, MAX_LINE_BYTES, StratumClientImpl, formatHostPort, formatStratumUrl, parseStratumUrl, } from './client.ts';
export type { StratumClientOptions, StratumScheme, StratumTuning, StratumUrl } from './client.ts';
export { NodeTransport, nodeTransport, type NodeTransportOptions } from './transport-node.ts';
export { WsTransport, bridgeUrl, wsTransport, type WsTransportOptions } from './transport-ws.ts';
/**
 * The transport used when none is given: WebSocket to `bridge` if set, else
 * TCP/TLS where node:net exists (Node, Deno, Bun). Browsers need a bridge.
 */
export declare function defaultTransport(options: Pick<StratumClientOptions, 'bridge' | 'tlsInsecure' | 'connectTimeoutMs'>, runtime?: RuntimeName): TransportFactory;
/** Builds a client; call connect() to subscribe and authorize. Throws on an invalid URL. */
export declare function createStratumClient(options: StratumClientOptions): StratumClient;
