import { getBoundDatabaseConnection } from "@getstrata/core/database/boundConnection";
import { getDefaultDatabasePool } from "@getstrata/core/database/defaultConnection";
import { jsonResponse } from "@getstrata/core/http/response";
import { RedisClient } from "bun";
import { CORE_CONFIG_TOKEN, REDIS_URL_CONFIG_KEY } from "./config";
import type { AppDependencies, ConfigStore } from "./contracts";

type PingableConnection = {
  unsafe<T>(query: string, params?: readonly unknown[]): Promise<T[]>;
};

interface CreateHealthRoutesOptions {
  pingOnHealth?: boolean;
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

function resolveHealthDatabase(): PingableConnection | null {
  const bound = getBoundDatabaseConnection();

  if (bound) {
    return bound;
  }

  try {
    return getDefaultDatabasePool();
  } catch {
    return null;
  }
}

async function pingDatabaseClient(connection: PingableConnection): Promise<boolean> {
  try {
    await connection.unsafe("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

async function checkDatabase(): Promise<boolean> {
  const connection = resolveHealthDatabase();

  if (!connection) {
    return false;
  }

  return await pingDatabaseClient(connection);
}

async function pingDatabase(): Promise<boolean> {
  return await checkDatabase();
}

async function checkRedis(redisUrl: string): Promise<boolean> {
  try {
    const client = new RedisClient(redisUrl);
    const response = await client.ping();

    return response === "PONG";
  } catch {
    return false;
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
): Promise<{ checks: Record<string, "ok" | "error" | "skipped">; ready: boolean }> {
  const checks: Record<string, "ok" | "error" | "skipped"> = {
    database: (await checkDatabase()) ? "ok" : "error",
  };

  const redisUrl = resolveRedisUrl(dependencies);

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
  return {
    "/health": async () => {
      const extra = await resolveExtraFields(options.extra);

      if (!options.pingOnHealth) {
        return jsonResponse({ status: "ok", ...extra });
      }

      const { checks, ready } = await collectDependencyChecks(dependencies);

      return jsonResponse(
        {
          status: ready ? "ok" : "error",
          checks,
          ...extra,
        },
        { status: ready ? 200 : 503 },
      );
    },

    "/ready": async () => {
      const extra = await resolveExtraFields(options.extra);
      const { checks, ready } = await collectDependencyChecks(dependencies);

      return jsonResponse(
        {
          status: ready ? "ready" : "not_ready",
          checks,
          ...extra,
        },
        { status: ready ? 200 : 503 },
      );
    },
  };
}

export type { CreateHealthRoutesOptions };
export { checkDatabase, checkRedis, createHealthRoutes, pingDatabase };
