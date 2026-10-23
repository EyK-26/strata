import type { Middleware } from "@getstrata/core/http/middleware";
import {
  currentRequestMeta,
  resolveRequestId,
  runWithRequestMeta,
} from "@getstrata/core/http/requestMetaContext";
import { readClientIp } from "../http/clientIp";
import { appLogger } from "./logger";

function createRequestLoggingMiddleware(): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    const ipAddress = readClientIp(request) ?? null;
    const requestId = resolveRequestId(request);
    return await runWithRequestMeta(
      {
        ...currentRequestMeta(),
        ipAddress,
        userAgent: request.headers.get("user-agent"),
        request,
        requestId,
      },
      async () => {
        const startedAt = performance.now();
        const response = await next();
        const durationMs = Math.round(performance.now() - startedAt);

        appLogger.info("HTTP request completed", {
          requestId,
          method: request.method,
          path: new URL(request.url).pathname,
          status: response.status,
          durationMs,
          ipAddress,
        });

        return response;
      },
    );
  };
}

export { createRequestLoggingMiddleware };
