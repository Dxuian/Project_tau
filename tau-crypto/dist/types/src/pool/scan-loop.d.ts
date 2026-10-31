import type { FromWorker, ToWorker } from './protocol.ts';
export declare class ScanLoop {
    private kernel;
    private current;
    private throttle;
    private running;
    private disposed;
    private readonly post;
    constructor(post: (msg: FromWorker) => void);
    handle(msg: ToWorker): Promise<void>;
    private align;
    private run;
    private bench;
}
export declare function errorText(err: unknown): string;
