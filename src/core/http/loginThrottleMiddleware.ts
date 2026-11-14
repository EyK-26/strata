import { testState } from "#strata-test-state";
import {
  BoundedThrottleStore,
  type MemoryThrottleStorageOptions,
} from "../runtime/boundedThrottleStore";
import { readClientIp } from "./clientIp";
import type { DisposableMemoryThrottle } from "./memoryThrottleMiddleware";
import type { Middleware } from "./middleware";
import {
  createRedisThrottleConsumer,
  type DisposableThrottle,
  type RedisThrottleClient,
  redisThrottleKey,
  type ThrottleIdentityPolicy,
  throttleUnavailableResponse,
} from "./throttleMiddleware";
import { tooManyRequestsResponse } from "./throttleResponse";

interface LoginThrottleOptions extends MemoryThrottleStorageOptions, ThrottleIdentityPolicy {
  redisUrl?: string;
  maxAttempts: number;
  decaySeconds: number;
  keyPrefix?: string;
  commandTimeoutMs?: number;
  redisClient?: RedisThrottleClient;
}

function resolveLoginIdentity(request: Request, trustForwardedFor = false): string {
  return readClientIp(request, { TRUST_FORWARDED_FOR: String(trustForwardedFor) }) ?? "unknown";
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
  options = Object.freeze({ ...options });
  const store = new BoundedThrottleStore(options.decaySeconds * 1000, options);
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 0)
    throw new Error("Invalid memory throttle limit.");
  let generation = testState.loginThrottleGeneration;
  const middleware: Middleware = async (request, next) => {
    if (generation !== testState.loginThrottleGeneration) {
      store.clear();
      generation = testState.loginThrottleGeneration;
    }
    const email = await resolveLoginEmail(request);
    const key = redisThrottleKey(
      request,
      options.keyPrefix ?? "login-throttle",
      JSON.stringify([resolveLoginIdentity(request, options.trustForwardedFor), email]),
      undefined,
      options.namespace,
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
): DisposableThrottle {
  options = Object.freeze({ ...options });
  const consume = createRedisThrottleConsumer(options);
  const prefix = options.keyPrefix ?? "login-throttle";

  const middleware: Middleware = async (request, next) => {
    const identity = resolveLoginIdentity(request, options.trustForwardedFor);
    const email = await resolveLoginEmail(request);
    const throttleKey = redisThrottleKey(
      request,
      prefix,
      JSON.stringify([identity, email]),
      undefined,
      options.namespace,
    );
    let attempts: number;
    try {
      attempts = await consume(throttleKey, options.decaySeconds);
    } catch {
      return throttleUnavailableResponse();
    }

    if (consume.isDisposed()) return throttleUnavailableResponse();
    if (attempts > options.maxAttempts) {
      return await tooManyRequestsResponse(
        request,
        "Too many login attempts. Try again later.",
        options.decaySeconds,
      );
    }

    return await next();
  };
  return Object.assign(middleware, { dispose: () => consume.dispose() });
}

function createLoginThrottleMiddleware(options: LoginThrottleOptions): DisposableThrottle {
  const redisUrl = options.redisUrl?.trim() ?? "";

  if (redisUrl) {
    return createRedisLoginThrottleMiddleware({ ...options, redisUrl });
  }

  return createMemoryLoginThrottleMiddleware(options);
}

export type { LoginThrottleOptions };
export {
  createLoginThrottleMiddleware,
  createMemoryLoginThrottleMiddleware,
  resolveLoginEmail,
  resolveLoginIdentity,
};
