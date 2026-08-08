import { RedisClient } from "bun";
import { currentAuthUser } from "../auth/authContext";
import type { Middleware } from "./middleware";

interface ThrottleOptions {
  redisUrl: string;
  maxAttempts: number;
  decaySeconds: number;
  keyPrefix?: string;
}

function resolveThrottleIdentity(request: Request): string {
  const user = currentAuthUser();

  if (user?.tokenId !== undefined) {
    return `token:${user.tokenId}`;
  }

  if (user) {
    return `user:${user.id}`;
  }

  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  );
}

function createThrottleMiddleware(options: ThrottleOptions): Middleware {
  const client = new RedisClient(options.redisUrl);
  const prefix = options.keyPrefix ?? "workhub:throttle:";

  return async (request: Request, next: () => Promise<Response>) => {
    const identity = resolveThrottleIdentity(request);
    const path = new URL(request.url).pathname;
    const throttleKey = `${prefix}${identity}:${path}`;

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

export { createThrottleMiddleware, resolveThrottleIdentity };
export type { ThrottleOptions };
