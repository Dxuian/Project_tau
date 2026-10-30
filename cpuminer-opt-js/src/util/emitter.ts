// Minimal typed event emitter (no Node dependency, works in browsers and workers).
export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<(value: any) => void>>();

  on<K extends keyof Events>(event: K, listener: (value: Events[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return () => set!.delete(listener);
  }

  once<K extends keyof Events>(event: K, listener: (value: Events[K]) => void): () => void {
    const off = this.on(event, (v) => {
      off();
      listener(v);
    });
    return off;
  }

  emit<K extends keyof Events>(event: K, value: Events[K]): void {
    for (const l of this.listeners.get(event) ?? []) {
      try {
        l(value);
      } catch (err) {
        queueMicrotask(() => {
          throw err;
        });
      }
    }
  }

  removeAll(): void {
    this.listeners.clear();
  }
}
