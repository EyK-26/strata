import {
  BoundedThrottleStore,
  type MemoryThrottleStats,
  type MemoryThrottleStorageOptions,
} from "../runtime/boundedThrottleStore";
import type { Middleware } from "./middleware";
import {
  redisThrottleKey,
  resolveThrottleQuota,
  type ThrottleQuotaPolicy,
  throttleUnavailableResponse,
} from "./throttleMiddleware";
import { tooManyRequestsResponse } from "./throttleResponse";

interface MemoryThrottleOptions extends MemoryThrottleStorageOptions {
  maxAttempts: number;
  decaySeconds: number;
  keyPrefix?: string;
  quotaPolicy?: ThrottleQuotaPolicy;
}

type DisposableMemoryThrottle = Middleware & { dispose(): void; stats(): MemoryThrottleStats };
let resetGeneration = 0;

function createMemoryThrottleMiddleware(options: MemoryThrottleOptions): DisposableMemoryThrottle {
  const store = new BoundedThrottleStore(options.decaySeconds * 1000, options);
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 0)
    throw new Error("Invalid memory throttle limit.");
  let generation = resetGeneration;
  const middleware: Middleware = async (request, next) => {
    if (generation !== resetGeneration) {
      store.clear();
      generation = resetGeneration;
    }
    let maxAttempts: number;
    try {
      maxAttempts = resolveThrottleQuota(request, options);
    } catch {
      return throttleUnavailableResponse();
    }
    const attempts = store.consume(
      redisThrottleKey(
        request,
        options.keyPrefix ?? "memory-throttle",
        resolveThrottleIdentity(request),
      ),
    );
    if (attempts === null) return throttleUnavailableResponse();
    if (attempts > maxAttempts)
      return await tooManyRequestsResponse(request, "Too many requests.", options.decaySeconds);
    return await next();
  };
  return Object.assign(middleware, { dispose: () => store.dispose(), stats: () => store.stats() });
}

import { resolveThrottleIdentity } from "./throttleMiddleware";

/** Lazy generation reset avoids retaining middleware instances in a global test registry. */
function resetMemoryThrottleForTests(): void {
  resetGeneration++;
}

export type {
  DisposableMemoryThrottle,
  MemoryThrottleOptions,
  MemoryThrottleStats,
  MemoryThrottleStorageOptions,
};
export { createMemoryThrottleMiddleware, resetMemoryThrottleForTests };
