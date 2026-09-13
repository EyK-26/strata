import { createHash } from "node:crypto";
import { RedisClient } from "bun";
import { namespacedRedisKey } from "../runtime/appKeyPrefix";
import { readClientIp } from "./clientIp";
import type { Middleware } from "./middleware";

interface ScimThrottleOptions {
  redisUrl?: string;
  maxAttempts: number;
  decaySeconds: number;
}

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

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

function throttleFromMemory(
  key: string,
  maxAttempts: number,
  decaySeconds: number,
): Response | null {
  const now = Date.now();
  const existing = memoryBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + decaySeconds * 1000 });
    return null;
  }

  existing.count += 1;

  if (existing.count > maxAttempts) {
    return Response.json(
      { error: "Too many SCIM requests." },
      { status: 429, headers: { "retry-after": String(decaySeconds) } },
    );
  }

  return null;
}

function createScimThrottleMiddleware(options: ScimThrottleOptions): Middleware {
  const client = options.redisUrl ? new RedisClient(options.redisUrl) : null;

  return async (request: Request, next: () => Promise<Response>) => {
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

    const limited = throttleFromMemory(key, options.maxAttempts, options.decaySeconds);

    if (limited) {
      return limited;
    }

    return await next();
  };
}

export type { ScimThrottleOptions };
export { createScimThrottleMiddleware };
