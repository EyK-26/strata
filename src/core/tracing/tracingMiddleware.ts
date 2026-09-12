import type { Middleware } from "@getstrata/core/http/middleware";
import { envFlagEnabled } from "../runtime/appEnv";
import { createSpan, exportOtelSpan } from "./otel";
import { runWithTraceContext } from "./traceContext";

function readClientTraceId(request: Request): string | null {
  if (!envFlagEnabled(process.env.APP_DEBUG)) {
    return null;
  }

  const raw = request.headers.get("x-trace-id")?.trim() ?? "";
  if (!raw) {
    return null;
  }

  const compact = raw.replace(/-/g, "");
  return /^[0-9a-f]{32}$/iu.test(compact) ? compact.toLowerCase() : null;
}

function createTracingMiddleware(): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    const traceId = readClientTraceId(request) ?? crypto.randomUUID().replace(/-/g, "");
    const spanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const startedAt = performance.now();
    const path = new URL(request.url).pathname;

    return await runWithTraceContext({ traceId, spanId }, async () => {
      const response = await next();
      const endedAt = performance.now();
      const headers = new Headers(response.headers);
      headers.set("x-trace-id", traceId);
      headers.set("x-span-id", spanId);
      headers.set("traceparent", `00-${traceId}-${spanId}-01`);
      headers.set("server-timing", `app;dur=${(endedAt - startedAt).toFixed(2)}`);

      void exportOtelSpan(
        createSpan({
          traceId,
          name: `${request.method} ${path}`,
          startedAt,
          endedAt,
          attributes: {
            "http.method": request.method,
            "http.route": path,
            "http.status_code": String(response.status),
          },
        }),
      ).catch(() => undefined);

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    });
  };
}

export { createTracingMiddleware };
