import { createHash } from "node:crypto";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { currentTenant, type TenantContext } from "@getstrata/core/tenant/tenantContext";
import { RedisClient } from "bun";
import { namespacedRedisKey } from "../runtime/appKeyPrefix";
import { readClientIp } from "./clientIp";
import type { Middleware } from "./middleware";
import { currentRequestMeta } from "./requestMetaContext";
import { tooManyRequestsResponse } from "./throttleResponse";

interface ThrottleQuotaContext {
  readonly request: Request;
  readonly tenant: TenantContext | null;
  readonly identity: string;
  readonly routeTemplate: string;
  readonly maxAttempts: number;
}

/** A synchronous application-owned attempt limit; the window remains fixed. */
type ThrottleQuotaPolicy = (context: ThrottleQuotaContext) => number;

interface ThrottleOptions {
  redisUrl: string;
  maxAttempts: number;
  decaySeconds: number;
  keyPrefix?: string;
  commandTimeoutMs?: number;
  redisClient?: RedisThrottleClient;
  quotaPolicy?: ThrottleQuotaPolicy;
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

type RedisThrottleClient = Pick<RedisClient, "send">;

// One script prevents a crashed requester from leaving an immortal counter.
// Repair an existing counter whose expiry is missing in the same operation.
const CONSUME_THROTTLE = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
`;

function redisThrottleKey(
  request: Request,
  prefix: string,
  identity: string,
  tenantId: number | null = currentTenant()?.id ?? null,
): string {
  const bucket = JSON.stringify([
    tenantId,
    request.method,
    currentRequestMeta().routeTemplate ?? "__unmatched__",
    identity,
  ]);
  return namespacedRedisKey(`${prefix}:${createHash("sha256").update(bucket).digest("hex")}`);
}

async function consumeRedisThrottle(
  client: RedisThrottleClient,
  key: string,
  decaySeconds: number,
  timeoutMs = 1000,
  signal?: AbortSignal,
): Promise<number> {
  const expiryMs = Math.max(1, Math.ceil(decaySeconds * 1000));
  if (
    !Number.isFinite(decaySeconds) ||
    decaySeconds < 0 ||
    !Number.isSafeInteger(expiryMs) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1
  ) {
    throw new Error("Invalid throttle expiry or command timeout.");
  }
  if (signal?.aborted) throw new Error("Throttle consumer is disposed.");
  let onAbort: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new Error("Throttle consumer is disposed."));
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    const result = await Promise.race([
      cancelled,
      client.send("EVAL", [CONSUME_THROTTLE, "1", key, String(expiryMs)]),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Throttle store deadline exceeded.")), timeoutMs);
      }),
    ]);
    const count = Number(result);
    if (!Number.isSafeInteger(count) || count < 1)
      throw new Error("Invalid throttle store response.");
    return count;
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

/** Reuse a healthy connection; failed owned connections are recreated on the next request. */
function createRedisThrottleConsumer(
  options: Pick<ThrottleOptions, "redisUrl" | "redisClient" | "commandTimeoutMs">,
) {
  let ownedClient: RedisClient | undefined;
  const controller = new AbortController();
  const consume = async (key: string, decaySeconds: number): Promise<number> => {
    if (controller.signal.aborted) throw new Error("Throttle consumer is disposed.");
    if (!options.redisClient && !ownedClient) {
      ownedClient = new RedisClient(options.redisUrl, { autoReconnect: false, maxRetries: 0 });
    }
    const client = options.redisClient ?? ownedClient;
    if (!client) throw new Error("Throttle client is required.");
    try {
      const attempts = await consumeRedisThrottle(
        client,
        key,
        decaySeconds,
        options.commandTimeoutMs,
        controller.signal,
      );
      if (controller.signal.aborted) throw new Error("Throttle consumer is disposed.");
      return attempts;
    } catch (error) {
      if (client === ownedClient) {
        ownedClient.close();
        ownedClient = undefined;
      }
      throw error;
    }
  };
  return Object.assign(consume, {
    isDisposed: () => controller.signal.aborted,
    dispose() {
      if (controller.signal.aborted) return;
      controller.abort();
      const client = ownedClient;
      ownedClient = undefined;
      client?.close();
    },
  });
}

type DisposableThrottle = Middleware & { dispose(): void };

function throttleUnavailableResponse(): Response {
  return Response.json(
    { error: "Rate limiting is temporarily unavailable." },
    {
      status: 503,
      headers: { "retry-after": "1" },
    },
  );
}

function resolveThrottleQuota(
  request: Request,
  options: Pick<ThrottleOptions, "maxAttempts" | "quotaPolicy">,
  identity = resolveThrottleIdentity(request),
): number {
  const limit = options.quotaPolicy
    ? options.quotaPolicy({
        request,
        tenant: currentTenant(),
        identity,
        routeTemplate: currentRequestMeta().routeTemplate ?? "__unmatched__",
        maxAttempts: options.maxAttempts,
      })
    : options.maxAttempts;
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new Error("Invalid application quota.");
  }
  return limit;
}

function createThrottleMiddleware(options: ThrottleOptions): DisposableThrottle {
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 0) {
    throw new Error("Throttle maxAttempts must be a non-negative safe integer.");
  }
  const consume = createRedisThrottleConsumer(options);
  const prefix = options.keyPrefix ?? "throttle";

  const middleware: Middleware = async (request, next) => {
    const identity = resolveThrottleIdentity(request);
    let maxAttempts: number;
    try {
      maxAttempts = resolveThrottleQuota(request, options, identity);
    } catch {
      return throttleUnavailableResponse();
    }
    const key = redisThrottleKey(request, prefix, identity);
    let attempts: number;
    try {
      attempts = await consume(key, options.decaySeconds);
    } catch {
      return throttleUnavailableResponse();
    }
    if (consume.isDisposed()) return throttleUnavailableResponse();
    if (attempts > maxAttempts) {
      return await tooManyRequestsResponse(request, "Too many requests.", options.decaySeconds);
    }
    return await next();
  };
  return Object.assign(middleware, { dispose: () => consume.dispose() });
}

export type {
  DisposableThrottle,
  RedisThrottleClient,
  ThrottleOptions,
  ThrottleQuotaContext,
  ThrottleQuotaPolicy,
};
export {
  consumeRedisThrottle,
  createRedisThrottleConsumer,
  createThrottleMiddleware,
  redisThrottleKey,
  resolveThrottleIdentity,
  resolveThrottleQuota,
  throttleUnavailableResponse,
};
