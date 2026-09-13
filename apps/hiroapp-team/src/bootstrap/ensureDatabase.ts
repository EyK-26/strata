import {
  ensurePostgresDatabaseAndAppRole,
  POSTGRES_APP_ROLE_PASSWORD,
} from "@getstrata/core/tenant/enableTenantRls";

const DEFAULT_DATABASE_URL =
  "postgresql://strata_app:dev-strata-app-change-me@localhost:5432/hiroapp_team";

/**
 * Runtime URL. Superuser CREATE ROLE / CREATE DATABASE / GRANT / migrate uses
 * MIGRATION_DATABASE_URL when set.
 */
function resolveAppDatabaseUrl(): string {
  const explicit = process.env.APP_DATABASE_URL?.trim();
  if (explicit) {
    return explicit;
  }
  return process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
}

export async function ensureAppDatabase(): Promise<string> {
  const url = resolveAppDatabaseUrl();
  await ensurePostgresDatabaseAndAppRole({
    runtimeUrl: url,
    migrationUrl: process.env.MIGRATION_DATABASE_URL,
    password: process.env.STRATA_APP_PASSWORD ?? POSTGRES_APP_ROLE_PASSWORD,
  });
  process.env.DATABASE_URL = url;
  return url;
}
