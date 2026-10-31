import { type NetworkName } from '../wallet/keys.ts';
import type { ShareRecord, ShareResult } from './stores.ts';
import type { BridgeConnection, BridgeInterceptor } from '../bridge/core.ts';
/** The pool login of a connection: the owner address its blocks pay, and its receive index. */
export interface PoolLogin {
    address: string;
    index?: number;
}
export interface ShareAuditorOptions {
    /**
     * What visitors are logged in to the pool as, so block rewards go to it: one
     * address for everyone, or a function giving each connection its own. The
     * function is called once per connection, when it first authorizes.
     */
    poolUser: string | ((info: {
        visitor: string;
        connection: BridgeConnection;
    }) => PoolLogin | Promise<PoolLogin>);
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
