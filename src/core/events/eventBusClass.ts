type EventListener = (payload: unknown) => void | Promise<void>;

/** Capability for publishing application events; listener ownership stays with composition. */
interface EventDispatcher {
  dispatch(event: string, payload: unknown): Promise<void>;
}

class EventBus implements EventDispatcher {
  private readonly transactionalListeners = new Map<string, Set<EventListener>>();

  listenTransactional(event: string, listener: EventListener): () => void {
    const handlers = this.transactionalListeners.get(event) ?? new Set<EventListener>();
    handlers.add(listener);
    this.transactionalListeners.set(event, handlers);
    return () => {
      handlers.delete(listener);
      if (!handlers.size) this.transactionalListeners.delete(event);
    };
  }

  hasTransactionalListeners(event: string): boolean {
    return (this.transactionalListeners.get(event)?.size ?? 0) > 0;
  }

  async dispatchTransactional(event: string, payload: unknown): Promise<void> {
    for (const listener of this.transactionalListeners.get(event) ?? []) await listener(payload);
  }

  private readonly listeners = new Map<string, Set<EventListener>>();

  on(event: string, listener: EventListener): () => void {
    return this.listen(event, listener);
  }

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

  async emit(event: string, payload: unknown): Promise<void> {
    await this.dispatch(event, payload);
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

export type { EventDispatcher, EventListener };
export { EventBus };
