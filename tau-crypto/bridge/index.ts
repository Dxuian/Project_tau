// tau-crypto/bridge: the WebSocket <-> TCP bridge that lets browsers reach
// stratum pools, for Node (createBridge) and Cloudflare Workers
// (createWorkerBridge), plus the share auditor that makes payouts verifiable.
export { BRIDGE_USAGE, createBridge, parseBridgeArgs, runBridgeCli } from './server.ts';
export type { Bridge, BridgeOptions } from './server.ts';
export { createWorkerBridge } from './worker.ts';
export type { WorkerBridgeOptions, WorkerConnect, WorkerSocket, WorkerWebSocket } from './worker.ts';
export { createShareAuditor } from './auditor.ts';
export type { ShareAuditorOptions } from './auditor.ts';
export { BRIDGE_FEATURES } from './core.ts';
export type { BridgeBaseOptions, BridgeConnection, BridgeInterceptor } from './core.ts';
