// Throttling, shared by the CPU scan loop and the GPU loop: after each chunk of
// work, idle long enough that work takes (1 - throttle) of the time.

/** The most a miner idles: 0.99 of the time, so 1% of full speed. */
export const MAX_THROTTLE = 0.99;

/** `value` as a throttle: 0 (none) to MAX_THROTTLE; anything else (NaN, negative) is 0. */
export function clampThrottle(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_THROTTLE, Math.max(0, value)) : 0;
}

/** How long to idle after `ms` of work, so that work is (1 - throttle) of the time. */
export function idleMs(ms: number, throttle: number): number {
  const t = clampThrottle(throttle);
  return t > 0 && ms > 0 ? (ms * t) / (1 - t) : 0;
}

/**
 * A sleep that wake() ends early. At 1% a chunk of ~100 ms is followed by ~10 s of
 * idling, so a new job, a stop or a new speed wakes the loop instead of waiting.
 */
export class Nap {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private done: (() => void) | null = null;

  sleep(ms: number): Promise<void> {
    this.wake();
    return new Promise((resolve) => {
      this.done = resolve;
      this.timer = setTimeout(() => this.wake(), ms);
    });
  }

  wake(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const done = this.done;
    this.done = null;
    done?.();
  }
}
