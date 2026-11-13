import type { PersistenceInvocation } from "@getstrata/core/contracts/persistence";
import { jsonResponse } from "@getstrata/core/http/response";
import { envFlagEnabled } from "@getstrata/core/runtime/appEnv";
import { RedisClient } from "bun";
import { CORE_CONFIG_TOKEN, REDIS_URL_CONFIG_KEY } from "./config";
import type { AppDependencies, ConfigStore } from "./contracts";

interface CreateHealthRoutesOptions {
  pingOnHealth?: boolean;
  /** Optional non-mutating schema check; applies to dependency-checked /health only. */
  schemaCheck?: () => boolean | Promise<boolean>;
  /** Text mode emits only ok/degraded for container readiness probes. */
  healthFormat?: "json" | "text";
  extra?:
    | Record<string, unknown>
    | (() => Record<string, unknown> | Promise<Record<string, unknown>>);
}

function resolveRedisUrl(dependencies: AppDependencies): string | undefined {
  if (!dependencies.container.has(CORE_CONFIG_TOKEN)) {
    return process.env.REDIS_URL?.trim() || undefined;
  }

  const config = dependencies.container.resolve<ConfigStore>(CORE_CONFIG_TOKEN);
  const redisUrl = config.get<string>(REDIS_URL_CONFIG_KEY)?.trim();

  return redisUrl || undefined;
}

async function pingDatabase(invoke: PersistenceInvocation): Promise<boolean> {
  try {
    return await invoke(
      { kind: "request", actor: { kind: "system", policy: "http.health" } },
      async ({ database }) => {
        await database.execute({ text: "SELECT 1", params: [] });
        return true;
      },
    );
  } catch {
    return false;
  }
}

async function checkRedis(redisUrl: string): Promise<boolean> {
  let client: RedisClient | undefined;
  try {
    client = new RedisClient(redisUrl, {
      connectionTimeout: 1000,
      idleTimeout: 1000,
      autoReconnect: false,
    });
    const response = await client.ping();

    return response === "PONG";
  } catch {
    return false;
  } finally {
    client?.close();
  }
}

async function resolveExtraFields(
  extra: CreateHealthRoutesOptions["extra"],
): Promise<Record<string, unknown>> {
  if (!extra) {
    return {};
  }

  return typeof extra === "function" ? await extra() : extra;
}

async function collectDependencyChecks(
  dependencies: AppDependencies,
  redisUrl: string | undefined,
): Promise<{ checks: Record<string, "ok" | "error" | "skipped">; ready: boolean }> {
  const checks: Record<string, "ok" | "error" | "skipped"> = {
    database: (await pingDatabase(dependencies.invoke)) ? "ok" : "error",
  };

  if (redisUrl) {
    checks.redis = (await checkRedis(redisUrl)) ? "ok" : "error";
  } else {
    checks.redis = "skipped";
  }

  const ready = checks.database === "ok" && (checks.redis === "ok" || checks.redis === "skipped");

  return { checks, ready };
}

function createHealthRoutes(
  dependencies: AppDependencies,
  options: CreateHealthRoutesOptions = {},
) {
  const redisUrl = resolveRedisUrl(dependencies);
  const debug = envFlagEnabled(process.env.APP_DEBUG);
  return {
    "/health": async (request?: Request) => {
      if (request && request.method !== "GET" && request.method !== "HEAD") {
        return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
      }
      const headers = { "cache-control": "no-store" };
      const extra = options.healthFormat === "text" ? {} : await resolveExtraFields(options.extra);

      if (!options.pingOnHealth) {
        return options.healthFormat === "text"
          ? new Response("ok", {
              headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
            })
          : jsonResponse({ status: "ok", ...extra }, { headers });
      }

      const { checks, ready: dependenciesReady } = await collectDependencyChecks(
        dependencies,
        redisUrl,
      );
      let schemaReady = true;
      if (options.schemaCheck) {
        try {
          schemaReady = await options.schemaCheck();
        } catch {
          schemaReady = false;
        }
      }
      if (options.schemaCheck) checks.schema = schemaReady ? "ok" : "error";
      const ready = dependenciesReady && schemaReady;
      if (options.healthFormat === "text") {
        return new Response(ready ? "ok" : "degraded", {
          status: ready ? 200 : 503,
          headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
        });
      }
      return jsonResponse(
        {
          status: ready ? "ok" : "error",
          checks,
          ...extra,
        },
        { status: ready ? 200 : 503, headers },
      );
    },

    "/ready": async () => {
      const extra = await resolveExtraFields(options.extra);
      const { checks, ready } = await collectDependencyChecks(dependencies, redisUrl);

      return jsonResponse(
        {
          status: ready ? "ready" : "not_ready",
          ...(debug ? { checks, ...extra } : {}),
        },
        { status: ready ? 200 : 503 },
      );
    },
  };
}

export type { CreateHealthRoutesOptions };

const checkDatabase = pingDatabase;

export { checkDatabase, checkRedis, createHealthRoutes, pingDatabase };
