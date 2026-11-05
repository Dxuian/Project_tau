/** The most a miner idles: 0.99 of the time, so 1% of full speed. */
export declare const MAX_THROTTLE = 0.99;
/** `value` as a throttle: 0 (none) to MAX_THROTTLE; anything else (NaN, negative) is 0. */
export declare function clampThrottle(value: number): number;
/** How long to idle after `ms` of work, so that work is (1 - throttle) of the time. */
export declare function idleMs(ms: number, throttle: number): number;
/**
 * A sleep that wake() ends early. At 1% a chunk of ~100 ms is followed by ~10 s of
 * idling, so a new job, a stop or a new speed wakes the loop instead of waiting.
 */
export declare class Nap {
    private timer;
    private done;
    sleep(ms: number): Promise<void>;
    wake(): void;
}
