import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { currentTenant, rateLimitMultiplierForPlan } from "@getstrata/core/tenant/tenantContext";
import { RedisClient } from "bun";
import { namespacedRedisKey } from "../runtime/appKeyPrefix";
import { readClientIp } from "./clientIp";
import type { Middleware } from "./middleware";
import { tooManyRequestsResponse } from "./throttleResponse";

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

  return readClientIp(request) ?? "unknown";
}

function createThrottleMiddleware(options: ThrottleOptions): Middleware {
  const client = new RedisClient(options.redisUrl);
  const prefix = options.keyPrefix ?? namespacedRedisKey("throttle:");

  return async (request: Request, next: () => Promise<Response>) => {
    const identity = resolveThrottleIdentity(request);
    const path = new URL(request.url).pathname;
    const throttleKey = `${prefix}${identity}:${path}`;

    const attempts = Number(await client.incr(throttleKey));

    if (attempts === 1) {
      await client.expire(throttleKey, options.decaySeconds);
    }

    const maxAttempts =
      options.maxAttempts * rateLimitMultiplierForPlan(currentTenant()?.plan ?? "free");

    if (attempts > maxAttempts) {
      return await tooManyRequestsResponse(request, "Too many requests.", options.decaySeconds);
    }

    return await next();
  };
}

export type { ThrottleOptions };
export { createThrottleMiddleware, resolveThrottleIdentity };
