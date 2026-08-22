import { readClientIp } from "./clientIp";
import type { Middleware } from "./middleware";

interface MemoryThrottleOptions {
  maxAttempts: number;
  decaySeconds: number;
  keyPrefix?: string;
}

const buckets = new Map<string, { count: number; resetAt: number }>();

function createMemoryThrottleMiddleware(options: MemoryThrottleOptions): Middleware {
  const prefix = options.keyPrefix ?? "workhub:memory-throttle:";

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

export type { MemoryThrottleOptions };
export { createMemoryThrottleMiddleware };
