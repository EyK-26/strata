import { AsyncLocalStorage } from "node:async_hooks";

function createAsyncContextStore<T>(key: string): AsyncLocalStorage<T> {
  const symbol = Symbol.for(key);
  const globalRecord = globalThis as Record<symbol, AsyncLocalStorage<T> | undefined>;
  const existing = globalRecord[symbol];

  if (existing) {
    return existing;
  }

  const store = new AsyncLocalStorage<T>();
  globalRecord[symbol] = store;
  return store;
}

export { createAsyncContextStore };
