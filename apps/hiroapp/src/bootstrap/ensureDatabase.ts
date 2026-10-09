import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import {
  ensurePostgresDatabaseAndAppRole,
  POSTGRES_APP_ROLE_PASSWORD,
} from "@getstrata/core/tenant/enableTenantRls";

const DEFAULT_DATABASE_URL =
  "postgresql://strata_app:dev-strata-app-change-me@localhost:5432/hiroapp";

/**
 * Runtime URL. Superuser CREATE ROLE / CREATE DATABASE / GRANT / migrate uses
 * MIGRATION_DATABASE_URL when set.
 */
function resolveAppDatabaseUrl(): string {
  const explicit = process.env.APP_DATABASE_URL?.trim();
  if (explicit) {
    return explicit;
  }
  const configured = process.env.DATABASE_URL?.trim();
  if (configured) return configured;
  if (isProductionEnv())
    throw new Error("DATABASE_URL or APP_DATABASE_URL is required in production/staging.");
  return DEFAULT_DATABASE_URL;
}

export async function ensureAppDatabase(options: { provision?: boolean } = {}): Promise<string> {
  const url = resolveAppDatabaseUrl();
  if (options.provision ?? !isProductionEnv()) {
    if (isProductionEnv()) {
      if (!process.env.MIGRATION_DATABASE_URL?.trim())
        throw new Error("MIGRATION_DATABASE_URL is required for production/staging provisioning.");
      const password = process.env.STRATA_APP_PASSWORD?.trim();
      if (!password || password === POSTGRES_APP_ROLE_PASSWORD)
        throw new Error(
          "Set an explicit non-development STRATA_APP_PASSWORD for production/staging provisioning.",
        );
    }
    await ensurePostgresDatabaseAndAppRole({
      runtimeUrl: url,
      migrationUrl: process.env.MIGRATION_DATABASE_URL,
      password: process.env.STRATA_APP_PASSWORD ?? POSTGRES_APP_ROLE_PASSWORD,
    });
  }
  process.env.DATABASE_URL = url;
  return url;
}
