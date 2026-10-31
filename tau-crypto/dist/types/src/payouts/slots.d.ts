export interface SlotOptions {
    /** Length of a slot in ms, e.g. 3_600_000 for a new address every hour. */
    periodMs: number;
    /** When slot 1 starts, in ms since 1970. */
    epochMs: number;
}
/** The slot `time` (ms) falls in: 1 + whole periods since the epoch. */
export declare function addressSlot(time: number, options: SlotOptions): number;
/** When `slot` starts and ends (ms; `until` is the next slot's start). */
export declare function slotTimes(slot: number, options: SlotOptions): {
    from: number;
    until: number;
};
