import { createHash } from "node:crypto";
import { RedisClient } from "bun";
import { namespacedRedisKey } from "../runtime/appKeyPrefix";
import {
  BoundedThrottleStore,
  type MemoryThrottleStorageOptions,
} from "../runtime/boundedThrottleStore";
import { readClientIp } from "./clientIp";
import type { Middleware } from "./middleware";
import { redisThrottleKey, throttleUnavailableResponse } from "./throttleMiddleware";

interface ScimThrottleOptions extends MemoryThrottleStorageOptions {
  redisUrl?: string;
  maxAttempts: number;
  decaySeconds: number;
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
  const store = options.redisUrl
    ? null
    : new BoundedThrottleStore(options.decaySeconds * 1000, options);
  const client = options.redisUrl ? new RedisClient(options.redisUrl) : null;

  let disposed = false;
  const middleware: Middleware = async (request, next) => {
    if (disposed) return throttleUnavailableResponse();
    const identity = resolveScimIdentity(request);
    const key = `${namespacedRedisKey("scim-throttle:")}${identity}`;

    if (client) {
      const attempts = Number(await client.incr(key));

      if (attempts === 1) {
        await client.expire(key, options.decaySeconds);
      }

      if (attempts > options.maxAttempts) {
        return Response.json(
          { error: "Too many SCIM requests." },
          { status: 429, headers: { "retry-after": String(options.decaySeconds) } },
        );
      }

      return await next();
    }

    const attempts = store?.consume(redisThrottleKey(request, "scim-throttle", identity));
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
      client?.close();
    },
    stats: () => store?.stats(),
  });
}

export type { ScimThrottleOptions };
export { createScimThrottleMiddleware };
