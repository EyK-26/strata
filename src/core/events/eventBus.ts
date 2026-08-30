type EventListener = (payload: unknown) => void | Promise<void>;

class EventBus {
  constructor() {}

  private readonly listeners = new Map<string, Set<EventListener>>();

  listen(event: string, listener: EventListener): () => void {
    const handlers = this.listeners.get(event) ?? new Set<EventListener>();
    handlers.add(listener);
    this.listeners.set(event, handlers);

    return () => {
      handlers.delete(listener);

      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  async dispatch(event: string, payload: unknown): Promise<void> {
    const handlers = this.listeners.get(event);

    if (!handlers || handlers.size === 0) {
      return;
    }

    for (const handler of handlers) {
      await handler(payload);
    }
  }
}

const EVENT_BUS_KEY = Symbol.for("@getstrata/eventBus");

function readSharedEventBus(): EventBus {
  const globalBus = (globalThis as Record<symbol, EventBus | undefined>)[EVENT_BUS_KEY];

  if (globalBus) {
    return globalBus;
  }

  const bus = new EventBus();
  (globalThis as Record<symbol, EventBus>)[EVENT_BUS_KEY] = bus;
  return bus;
}

const eventBus = readSharedEventBus();

export type { EventListener };
export { EventBus, eventBus, readSharedEventBus };
