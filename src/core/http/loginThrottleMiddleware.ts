import {
  BoundedThrottleStore,
  type MemoryThrottleStorageOptions,
} from "../runtime/boundedThrottleStore";
import { readClientIp } from "./clientIp";
import type { DisposableMemoryThrottle } from "./memoryThrottleMiddleware";
import type { Middleware } from "./middleware";
import {
  createRedisThrottleConsumer,
  type RedisThrottleClient,
  redisThrottleKey,
  throttleUnavailableResponse,
} from "./throttleMiddleware";
import { tooManyRequestsResponse } from "./throttleResponse";

interface LoginThrottleOptions extends MemoryThrottleStorageOptions {
  redisUrl?: string;
  maxAttempts: number;
  decaySeconds: number;
  keyPrefix?: string;
  commandTimeoutMs?: number;
  redisClient?: RedisThrottleClient;
}

let resetGeneration = 0;

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

function createMemoryLoginThrottleMiddleware(
  options: LoginThrottleOptions,
): DisposableMemoryThrottle {
  const store = new BoundedThrottleStore(options.decaySeconds * 1000, options);
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 0)
    throw new Error("Invalid memory throttle limit.");
  let generation = resetGeneration;
  const middleware: Middleware = async (request, next) => {
    if (generation !== resetGeneration) {
      store.clear();
      generation = resetGeneration;
    }
    const email = await resolveLoginEmail(request);
    const key = redisThrottleKey(
      request,
      options.keyPrefix ?? "login-throttle",
      JSON.stringify([resolveLoginIdentity(request), email]),
    );
    const attempts = store.consume(key);
    if (attempts === null) return throttleUnavailableResponse();
    if (attempts > options.maxAttempts)
      return await tooManyRequestsResponse(
        request,
        "Too many login attempts. Try again later.",
        options.decaySeconds,
      );
    return await next();
  };
  return Object.assign(middleware, { dispose: () => store.dispose(), stats: () => store.stats() });
}

function createRedisLoginThrottleMiddleware(
  options: LoginThrottleOptions & { redisUrl: string },
): Middleware {
  const consume = createRedisThrottleConsumer(options);
  const prefix = options.keyPrefix ?? "login-throttle";

  return async (request: Request, next: () => Promise<Response>) => {
    const identity = resolveLoginIdentity(request);
    const email = await resolveLoginEmail(request);
    const throttleKey = redisThrottleKey(request, prefix, JSON.stringify([identity, email]));
    let attempts: number;
    try {
      attempts = await consume(throttleKey, options.decaySeconds);
    } catch {
      return throttleUnavailableResponse();
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

function createLoginThrottleMiddleware(options: LoginThrottleOptions): Middleware {
  const redisUrl = options.redisUrl?.trim() ?? "";

  if (redisUrl) {
    return createRedisLoginThrottleMiddleware({ ...options, redisUrl });
  }

  return createMemoryLoginThrottleMiddleware(options);
}

function resetMemoryLoginThrottleForTests(): void {
  resetGeneration++;
}

export type { LoginThrottleOptions };
export {
  createLoginThrottleMiddleware,
  createMemoryLoginThrottleMiddleware,
  resetMemoryLoginThrottleForTests,
  resolveLoginEmail,
  resolveLoginIdentity,
};
