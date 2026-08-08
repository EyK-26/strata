import { RedisClient } from "bun";
import type { Middleware } from "./middleware";

interface ThrottleOptions {
  redisUrl: string;
  maxAttempts: number;
  decaySeconds: number;
  keyPrefix?: string;
}

function createThrottleMiddleware(options: ThrottleOptions): Middleware {
  const client = new RedisClient(options.redisUrl);
  const prefix = options.keyPrefix ?? "workhub:throttle:";

  return async (request: Request, next: () => Promise<Response>) => {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    const path = new URL(request.url).pathname;
    const throttleKey = `${prefix}${ip}:${path}`;

    const attempts = Number(await client.incr(throttleKey));

    if (attempts === 1) {
      await client.expire(throttleKey, options.decaySeconds);
    }

    if (attempts > options.maxAttempts) {
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

export { createThrottleMiddleware };
export type { ThrottleOptions };
