import { PayloadTooLargeError } from "../errors/http";
import type { Middleware } from "./middleware";

const DEFAULT_MAX_BODY_BYTES = 1_048_576;

function resolveMaxBodyBytes(): number {
  const raw = process.env.MAX_REQUEST_BODY_BYTES?.trim();

  if (!raw) {
    return DEFAULT_MAX_BODY_BYTES;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_MAX_BODY_BYTES;
  }

  return parsed;
}

function createBodySizeLimitMiddleware(maxBytes = resolveMaxBodyBytes()): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    const contentLength = request.headers.get("content-length");

    if (contentLength) {
      const bytes = Number.parseInt(contentLength, 10);

      if (Number.isInteger(bytes) && bytes > maxBytes) {
        const error = new PayloadTooLargeError(`Request body exceeds the ${maxBytes} byte limit.`);
        return Response.json({ error: error.message }, { status: error.status });
      }
    }

    return await next();
  };
}

export { createBodySizeLimitMiddleware, resolveMaxBodyBytes };
