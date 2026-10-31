import { type NetworkName } from '../wallet/keys.ts';
import type { ShareRecord, ShareResult } from './stores.ts';
import type { BridgeConnection, BridgeInterceptor } from '../bridge/core.ts';
export interface ShareAuditorOptions {
    /** Address every visitor is logged in to the pool as: block rewards go to it. */
    poolUser: string;
    network?: NetworkName;
    /** Stores a share; awaited before the share is forwarded to the pool. */
    onShare: (record: ShareRecord) => void | Promise<void>;
    /** The pool's verdict on a share. */
    onResult?: (result: ShareResult) => void | Promise<void>;
    log?: (line: string) => void;
    /** Per connection (default 50). */
    maxSharesPer10s?: number;
}
export declare function createShareAuditor(options: ShareAuditorOptions): (connection: BridgeConnection) => BridgeInterceptor;
