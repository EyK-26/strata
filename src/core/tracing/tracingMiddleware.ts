import { randomUUID } from "node:crypto";
import type { Middleware } from "../http/middleware";

interface TraceContext {
  traceId: string;
  spanId: string;
}

const traceStorage = new Map<string, TraceContext>();

function createTracingMiddleware(): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    const traceId = request.headers.get("x-trace-id") ?? randomUUID();
    const spanId = randomUUID().slice(0, 16);
    const startedAt = performance.now();

    const response = await next();
    const headers = new Headers(response.headers);
    headers.set("x-trace-id", traceId);
    headers.set("x-span-id", spanId);
    headers.set("server-timing", `app;dur=${(performance.now() - startedAt).toFixed(2)}`);

    traceStorage.set(traceId, { traceId, spanId });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

function getTraceContext(traceId: string): TraceContext | undefined {
  return traceStorage.get(traceId);
}

export { createTracingMiddleware, getTraceContext };
export type { TraceContext };
