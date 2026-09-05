import { RedisClient } from "bun";
import { namespacedRedisKey } from "../runtime/appKeyPrefix";
import { readClientIp } from "./clientIp";
import type { Middleware } from "./middleware";
import { tooManyRequestsResponse } from "./throttleResponse";

interface LoginThrottleOptions {
  redisUrl: string;
  maxAttempts: number;
  decaySeconds: number;
  keyPrefix?: string;
}

function resolveLoginIdentity(request: Request): string {
  return readClientIp(request) ?? "unknown";
}

async function resolveLoginEmail(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  try {
    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const formData = await request.clone().formData();
      const email = formData.get("email");

      return typeof email === "string" ? email.trim().toLowerCase() : "unknown";
    }

    const payload = (await request.clone().json()) as { email?: unknown };

    return typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "unknown";
  } catch {
    return "unknown";
  }
}

function createLoginThrottleMiddleware(options: LoginThrottleOptions): Middleware {
  const client = new RedisClient(options.redisUrl);
  const prefix = options.keyPrefix ?? namespacedRedisKey("login-throttle:");

  return async (request: Request, next: () => Promise<Response>) => {
    const identity = resolveLoginIdentity(request);
    const email = await resolveLoginEmail(request);
    const throttleKey = `${prefix}${identity}:${email}`;

    const attempts = Number(await client.incr(throttleKey));

    if (attempts === 1) {
      await client.expire(throttleKey, options.decaySeconds);
    }

    if (attempts > options.maxAttempts) {
      return await tooManyRequestsResponse(
        request,
        "Too many login attempts. Try again later.",
        options.decaySeconds,
      );
    }

    return await next();
  };
}

export type { LoginThrottleOptions };
export { createLoginThrottleMiddleware, resolveLoginIdentity };
