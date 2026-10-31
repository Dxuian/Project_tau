// tau-crypto/bridge: the WebSocket <-> TCP bridge that lets browsers reach
// stratum pools, as a web-standard fetch(request) handler. It runs wherever
// the runtime can accept WebSocket upgrades and open TCP sockets, which it
// passes in. No Node or platform code; the Node server is tau-crypto/bridge/node.
export { createFetchBridge } from './fetch.ts';
export type { FetchBridgeOptions, PoolSocket, ServerWebSocket } from './fetch.ts';
export { BRIDGE_FEATURES, parseTarget, poolTarget } from './core.ts';
export type { BridgeBaseOptions, BridgeConnection, BridgeInterceptor } from './core.ts';
