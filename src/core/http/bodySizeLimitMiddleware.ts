import { PayloadTooLargeError } from "@getstrata/core/errors/http";
import type { Middleware } from "./middleware";

type BodyGuard = { maxBytes: number; exceeded: boolean };
const guards = new WeakMap<Request, BodyGuard>();

// Keep the native Request identity (requestIP/timeout/upgrade) and route metadata.
// Only consumption delegates to a bounded stream; nothing buffers the whole body.
function guardBody(request: Request, maxBytes: number): BodyGuard {
  const existing = guards.get(request);
  if (existing && existing.maxBytes <= maxBytes) return existing;
  const state = { maxBytes, exceeded: false };
  const body = request.body;
  if (!body) return state;
  let consumed = 0;
  const stream = body.pipeThrough(
    new TransformStream<Uint8Array | string, Uint8Array>({
      transform(chunk, controller) {
        const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
        consumed += bytes.byteLength;
        if (consumed > maxBytes) {
          state.exceeded = true;
          throw new PayloadTooLargeError(`Request body exceeds the ${maxBytes} byte limit.`);
        }
        controller.enqueue(bytes);
      },
    }),
  );
  const bounded = new Request(request, { body: stream });
  const decorateClone = (clone: Request): Request => {
    for (const field of ["params", "cookies"] as const) {
      if (field in request)
        Object.defineProperty(clone, field, { value: Reflect.get(request, field) });
    }
    const nativeClone = (): Request => Reflect.apply(Request.prototype.clone, clone, []) as Request;
    Object.defineProperty(clone, "clone", {
      value: () => decorateClone(nativeClone()),
    });
    guards.set(clone, state);
    return clone;
  };
  const descriptors: PropertyDescriptorMap = {
    body: { configurable: true, get: () => bounded.body },
    bodyUsed: { configurable: true, get: () => bounded.bodyUsed },
    clone: {
      configurable: true,
      value: () => decorateClone(Reflect.apply(Request.prototype.clone, bounded, []) as Request),
    },
  };
  for (const method of [
    "text",
    "json",
    "formData",
    "arrayBuffer",
    "blob",
    "bytes",
    "textStream",
  ] as const) {
    descriptors[method] = { configurable: true, value: bounded[method].bind(bounded) };
  }
  Object.defineProperties(request, descriptors);
  guards.set(request, state);
  return state;
}

const DEFAULT_MAX_BODY_BYTES = 1_048_576;

function resolveMaxBodyBytes(): number {
  const raw = process.env.MAX_REQUEST_BODY_BYTES?.trim();

  if (!raw) {
    return DEFAULT_MAX_BODY_BYTES;
  }

  const parsed = Number(raw);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return DEFAULT_MAX_BODY_BYTES;
  }

  return parsed;
}

function createBodySizeLimitMiddleware(maxBytes = resolveMaxBodyBytes()): Middleware {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new RangeError("Body limit must be a positive safe integer.");
  return async (request, next) => {
    const tooLarge = () => {
      const error = new PayloadTooLargeError(`Request body exceeds the ${maxBytes} byte limit.`);
      return Response.json({ error: error.message }, { status: error.status });
    };
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes) return tooLarge();
    const state = guardBody(request, maxBytes);
    try {
      const response = await next();
      return state.exceeded ? tooLarge() : response;
    } catch (error) {
      if (state.exceeded || error instanceof PayloadTooLargeError) return tooLarge();
      throw error;
    }
  };
}

export { createBodySizeLimitMiddleware, resolveMaxBodyBytes };
