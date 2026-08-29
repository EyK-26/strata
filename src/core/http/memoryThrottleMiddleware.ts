import { namespacedRedisKey } from "../runtime/appKeyPrefix";
import { readClientIp } from "./clientIp";
import type { Middleware } from "./middleware";

interface MemoryThrottleOptions {
  maxAttempts: number;
  decaySeconds: number;
  keyPrefix?: string;
}

type ThrottleBucket = { count: number; resetAt: number };

const throttleBucketRegistries = new Set<Map<string, ThrottleBucket>>();

function createMemoryThrottleMiddleware(options: MemoryThrottleOptions): Middleware {
  const prefix = options.keyPrefix ?? namespacedRedisKey("memory-throttle:");
  const buckets = new Map<string, ThrottleBucket>();
  throttleBucketRegistries.add(buckets);

  return async (request: Request, next: () => Promise<Response>) => {
    const path = new URL(request.url).pathname;
    const identity =
      readClientIp(request) ?? request.headers.get("authorization")?.slice(0, 32) ?? "unknown";
    const key = `${prefix}${identity}:${path}`;
    const now = Date.now();
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.decaySeconds * 1000 });
      return await next();
    }

    existing.count += 1;

    if (existing.count > options.maxAttempts) {
      return Response.json(
        { error: "Too many requests." },
        {
          status: 429,
          headers: {
            "retry-after": String(options.decaySeconds),
          },
        },
      );
    }

    return await next();
  };
}

function resetMemoryThrottleForTests(): void {
  for (const buckets of throttleBucketRegistries) {
    buckets.clear();
  }
}

export type { MemoryThrottleOptions };
export { createMemoryThrottleMiddleware, resetMemoryThrottleForTests };
