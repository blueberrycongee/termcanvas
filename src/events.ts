type EventListener<T> = [T] extends [undefined] ? () => void : (payload: T) => void;

class TypedEventBus<T extends object> {
  private listeners = new Map<keyof T & string, Set<(...args: unknown[]) => void>>();

  on<K extends keyof T & string>(
    event: K,
    listener: EventListener<T[K]>,
  ): () => void {
    let eventListeners = this.listeners.get(event);
    if (!eventListeners) {
      eventListeners = new Set();
      this.listeners.set(event, eventListeners);
    }

    const wrapped = listener as (...args: unknown[]) => void;
    eventListeners.add(wrapped);

    return () => {
      const current = this.listeners.get(event);
      if (!current) {
        return;
      }
      current.delete(wrapped);
      if (current.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  emit<K extends keyof T & string>(
    event: K,
    ...payload: [T[K]] extends [undefined] ? [] : [payload: T[K]]
  ): void {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners || eventListeners.size === 0) {
      return;
    }

    const snapshot = Array.from(eventListeners);
    if (payload.length === 0) {
      for (const listener of snapshot) {
        listener();
      }
      return;
    }

    const value = payload[0];
    for (const listener of snapshot) {
      listener(value);
    }
  }
}

export interface AppEventMap {
  "terminal:focus": { terminalId: string };
  "composer:focus": undefined;
  "terminal:title-edit-focus": { terminalId: string };
  "worktree:activity": { worktreePath: string };
}

export function createTypedEventBus<T extends object>() {
  return new TypedEventBus<T>();
}

export const appEvents = createTypedEventBus<AppEventMap>();
