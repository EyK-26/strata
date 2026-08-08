import { RedisClient } from "bun";
import { pingDatabase, ensureDatabaseConnection } from "../db/connection";
import { jsonResponse } from "../core/http";
import type { AppDependencies } from "./contracts";
import {
  CORE_CONFIG_TOKEN,
  REDIS_URL_CONFIG_KEY,
} from "./config";
import type { ConfigStore } from "./contracts";

function resolveRedisUrl(dependencies: AppDependencies): string | undefined {
  if (!dependencies.container.has(CORE_CONFIG_TOKEN)) {
    return process.env.REDIS_URL?.trim() || undefined;
  }

  const config =
    dependencies.container.resolve<ConfigStore>(CORE_CONFIG_TOKEN);
  const redisUrl = config.get<string>(REDIS_URL_CONFIG_KEY)?.trim();

  return redisUrl || undefined;
}

async function checkDatabase(): Promise<boolean> {
  await ensureDatabaseConnection();
  return await pingDatabase();
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

function createHealthRoutes(dependencies: AppDependencies) {
  return {
    "/health": async () => jsonResponse({ status: "ok" }),

    "/ready": async () => {
      const checks: Record<string, "ok" | "error" | "skipped"> = {
        database: (await checkDatabase()) ? "ok" : "error",
      };

      const redisUrl = resolveRedisUrl(dependencies);

      if (redisUrl) {
        checks.redis = (await checkRedis(redisUrl)) ? "ok" : "error";
      } else {
        checks.redis = "skipped";
      }

      const ready =
        checks.database === "ok" &&
        (checks.redis === "ok" || checks.redis === "skipped");

      return jsonResponse(
        {
          status: ready ? "ready" : "not_ready",
          checks,
        },
        { status: ready ? 200 : 503 },
      );
    },
  };
}

export { checkDatabase, checkRedis, createHealthRoutes };
