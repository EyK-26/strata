import type { Middleware } from "@getstrata/core/http/middleware";
import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { currentRequestMeta } from "../http/requestMetaContext";
import { getTracingRuntime, type TracingRuntime } from "./otel";
import { runWithTraceContext } from "./traceContext";

const headerGetter = {
  keys: (headers: Headers) => [...headers.keys()],
  get: (headers: Headers, key: string) => headers.get(key) ?? undefined,
};
const methods = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "CONNECT",
  "TRACE",
]);
function createTracingMiddleware(runtime?: TracingRuntime): Middleware {
  return async (request, next) => {
    const telemetry = runtime ?? getTracingRuntime();
    const method = methods.has(request.method) ? request.method : "_OTHER";
    const route = currentRequestMeta().routeTemplate ?? "__unmatched__";
    const parent = telemetry.propagator.extract(ROOT_CONTEXT, request.headers, headerGetter);
    const span = telemetry.tracer.startSpan(
      `${method} ${route}`,
      {
        kind: SpanKind.SERVER,
        attributes: { "http.request.method": method, "http.route": route },
      },
      parent,
    );
    const identity = span.spanContext();
    const started = performance.now();
    return await telemetry.run(trace.setSpan(parent, span), () =>
      runWithTraceContext({ traceId: identity.traceId, spanId: identity.spanId }, async () => {
        try {
          const response = await next();
          span.setAttribute("http.response.status_code", response.status);
          if (response.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
          const headers = new Headers(response.headers);
          headers.delete("tracestate");
          headers.set("x-trace-id", identity.traceId);
          headers.set("x-span-id", identity.spanId);
          // Preserve the sampling decision and validated tracestate through the standard propagator.
          telemetry.propagator.inject(trace.setSpan(parent, span), headers, {
            set: (carrier, key, value) => carrier.set(key, value),
          });
          headers.set("server-timing", `app;dur=${(performance.now() - started).toFixed(2)}`);
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        } catch (error) {
          // Exception text, URL, cookies and headers may contain secrets: do not record them.
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
      }),
    );
  };
}

export type { TracingMetricsSnapshot } from "./health";
export { renderTracingMetrics } from "./health";
export type { TracingOptions, TracingRuntime } from "./otel";
export { acquireTracingRuntime, createTracingRuntime, getTracingRuntime } from "./otel";
export { createTracingMiddleware };
