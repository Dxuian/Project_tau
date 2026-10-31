export declare class Emitter<Events extends Record<string, unknown>> {
    private listeners;
    on<K extends keyof Events>(event: K, listener: (value: Events[K]) => void): () => void;
    once<K extends keyof Events>(event: K, listener: (value: Events[K]) => void): () => void;
    emit<K extends keyof Events>(event: K, value: Events[K]): void;
    removeAll(): void;
}
