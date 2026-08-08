type EventListener = (payload: unknown) => void | Promise<void>;

class EventBus {
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

const eventBus = new EventBus();

export type { EventListener };
export { EventBus, eventBus };
