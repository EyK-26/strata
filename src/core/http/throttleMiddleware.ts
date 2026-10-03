import { createHash } from "node:crypto";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { currentTenant, rateLimitMultiplierForPlan } from "@getstrata/core/tenant/tenantContext";
import { RedisClient } from "bun";
import { namespacedRedisKey } from "../runtime/appKeyPrefix";
import { readClientIp } from "./clientIp";
import type { Middleware } from "./middleware";
import { currentRequestMeta } from "./requestMetaContext";
import { tooManyRequestsResponse } from "./throttleResponse";

interface ThrottleOptions {
  redisUrl: string;
  maxAttempts: number;
  decaySeconds: number;
  keyPrefix?: string;
  commandTimeoutMs?: number;
  redisClient?: RedisThrottleClient;
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

function redisThrottleKey(request: Request, prefix: string, identity: string): string {
  const bucket = JSON.stringify([
    currentTenant()?.id ?? null,
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
): Promise<number> {
  if (
    !Number.isFinite(decaySeconds) ||
    decaySeconds < 0 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1
  ) {
    throw new Error("Invalid throttle expiry or command timeout.");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      client.send("EVAL", [
        CONSUME_THROTTLE,
        "1",
        key,
        String(Math.max(1, Math.ceil(decaySeconds * 1000))),
      ]),
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
  }
}

/** Reuse a healthy connection; failed owned connections are recreated on the next request. */
function createRedisThrottleConsumer(
  options: Pick<ThrottleOptions, "redisUrl" | "redisClient" | "commandTimeoutMs">,
) {
  let ownedClient: RedisClient | undefined;
  return async (key: string, decaySeconds: number): Promise<number> => {
    if (!options.redisClient && !ownedClient) {
      ownedClient = new RedisClient(options.redisUrl, { autoReconnect: false, maxRetries: 0 });
    }
    const client = options.redisClient ?? ownedClient;
    if (!client) throw new Error("Throttle client is required.");
    try {
      return await consumeRedisThrottle(client, key, decaySeconds, options.commandTimeoutMs);
    } catch (error) {
      if (client === ownedClient) {
        ownedClient.close();
        ownedClient = undefined;
      }
      throw error;
    }
  };
}

function throttleUnavailableResponse(): Response {
  return Response.json(
    { error: "Rate limiting is temporarily unavailable." },
    {
      status: 503,
      headers: { "retry-after": "1" },
    },
  );
}

function createThrottleMiddleware(options: ThrottleOptions): Middleware {
  const consume = createRedisThrottleConsumer(options);
  const prefix = options.keyPrefix ?? "throttle";

  return async (request: Request, next: () => Promise<Response>) => {
    const key = redisThrottleKey(request, prefix, resolveThrottleIdentity(request));
    let attempts: number;
    try {
      attempts = await consume(key, options.decaySeconds);
    } catch {
      return throttleUnavailableResponse();
    }
    const maxAttempts =
      options.maxAttempts * rateLimitMultiplierForPlan(currentTenant()?.plan ?? "free");
    if (attempts > maxAttempts) {
      return await tooManyRequestsResponse(request, "Too many requests.", options.decaySeconds);
    }
    return await next();
  };
}

export type { RedisThrottleClient, ThrottleOptions };
export {
  consumeRedisThrottle,
  createRedisThrottleConsumer,
  createThrottleMiddleware,
  redisThrottleKey,
  resolveThrottleIdentity,
  throttleUnavailableResponse,
};
