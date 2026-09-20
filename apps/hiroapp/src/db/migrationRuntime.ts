import { join } from "node:path";
import { loadMigrationsFromDirectory } from "@getstrata/core/database/migrations/runner";
import type { MigrationDatabase } from "@getstrata/core/database/migrations/types";
import {
  grantPostgresAppRolePrivileges,
  openPostgresAdminConnection,
  postgresDatabaseNameFromUrl,
} from "@getstrata/core/tenant/enableTenantRls";

const MIGRATIONS_DIRECTORY = join(import.meta.dir, "migrations");

export async function loadStarterMigrations() {
  return loadMigrationsFromDirectory(MIGRATIONS_DIRECTORY);
}

export async function withMigrationDatabase<T>(
  fn: (db: MigrationDatabase) => Promise<T>,
): Promise<T> {
  const runtimeUrl = process.env.DATABASE_URL ?? "";
  const admin = await openPostgresAdminConnection({
    runtimeUrl,
    migrationUrl: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    const result = await fn(admin);
    await grantPostgresAppRolePrivileges(admin, {
      database: postgresDatabaseNameFromUrl(runtimeUrl),
    });
    return result;
  } finally {
    await admin.close?.();
  }
}
