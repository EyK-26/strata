import { createHash } from "node:crypto";
import {
  BoundedThrottleStore,
  type MemoryThrottleStorageOptions,
} from "../runtime/boundedThrottleStore";
import { readClientIp } from "./clientIp";
import type { Middleware } from "./middleware";
import {
  createRedisThrottleConsumer,
  type RedisThrottleClient,
  redisThrottleKey,
  throttleUnavailableResponse,
} from "./throttleMiddleware";

interface ScimThrottleOptions extends MemoryThrottleStorageOptions {
  redisUrl?: string;
  maxAttempts: number;
  decaySeconds: number;
  commandTimeoutMs?: number;
  redisClient?: RedisThrottleClient;
  keyPrefix?: string;
}

function resolveScimIdentity(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const presented = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (presented.length > 0) {
    return createHash("sha256").update(presented).digest("hex");
  }

  return readClientIp(request) ?? "unknown";
}

function createScimThrottleMiddleware(options: ScimThrottleOptions) {
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 0)
    throw new Error("Invalid SCIM throttle limit.");
  const redisUrl = options.redisUrl?.trim() ?? "";
  const distributed = Boolean(redisUrl || options.redisClient);
  const store = distributed ? null : new BoundedThrottleStore(options.decaySeconds * 1000, options);
  const consume = distributed ? createRedisThrottleConsumer({ ...options, redisUrl }) : null;

  let disposed = false;
  const middleware: Middleware = async (request, next) => {
    if (disposed) return throttleUnavailableResponse();
    const identity = resolveScimIdentity(request);
    const key = redisThrottleKey(request, options.keyPrefix ?? "scim-throttle:v2", identity);
    let attempts: number | null | undefined;
    try {
      attempts = consume ? await consume(key, options.decaySeconds) : store?.consume(key);
    } catch {
      return throttleUnavailableResponse();
    }
    if (disposed) return throttleUnavailableResponse();
    if (attempts === null || attempts === undefined) return throttleUnavailableResponse();
    if (attempts > options.maxAttempts)
      return Response.json(
        { error: "Too many SCIM requests." },
        { status: 429, headers: { "retry-after": String(options.decaySeconds) } },
      );

    return await next();
  };
  return Object.assign(middleware, {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      store?.dispose();
      consume?.dispose();
    },
    stats: () => store?.stats(),
  });
}

export type { ScimThrottleOptions };
export { createScimThrottleMiddleware, resolveScimIdentity };
