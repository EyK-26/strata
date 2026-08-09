import { RedisClient } from "bun";
import type { Middleware } from "./middleware";

interface ScimThrottleOptions {
  redisUrl?: string;
  maxAttempts: number;
  decaySeconds: number;
}

function createScimThrottleMiddleware(options: ScimThrottleOptions): Middleware {
  const client = options.redisUrl ? new RedisClient(options.redisUrl) : null;

  return async (request: Request, next: () => Promise<Response>) => {
    const identity =
      request.headers.get("authorization")?.slice("Bearer ".length, "Bearer ".length + 16) ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    const key = `workhub:scim-throttle:${identity}`;

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
    }

    return await next();
  };
}

export type { ScimThrottleOptions };
export { createScimThrottleMiddleware };
