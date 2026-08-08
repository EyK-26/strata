import { AsyncLocalStorage } from "node:async_hooks";

type TraceContext = {
  traceId: string;
  spanId: string;
};

const traceContextStorage = new AsyncLocalStorage<TraceContext>();

function runWithTraceContext<T>(
  context: TraceContext,
  callback: () => T | Promise<T>,
): T | Promise<T> {
  return traceContextStorage.run(context, callback);
}

function currentTraceId(): string | null {
  return traceContextStorage.getStore()?.traceId ?? null;
}

export type { TraceContext };
export { currentTraceId, runWithTraceContext, traceContextStorage };
