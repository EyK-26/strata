import { createAsyncContextStore } from "../runtime/asyncContextStore";

type TraceContext = {
  traceId: string;
  spanId: string;
};

const traceContextStorage = createAsyncContextStore<TraceContext>("@getstrata/traceContext");

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
