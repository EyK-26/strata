import { dropPostgresTablesAsAdmin } from "@getstrata/core/tenant/enableTenantRls";
import { closeDatabase } from "../bootstrap/database.ts";
import { ensureAppDatabase } from "../bootstrap/ensureDatabase.ts";
import { migrate } from "./migrate.ts";

const tables = ["sessions", "auth_saml_assertions", "auth_one_time_tokens", "users", "notes"];

export async function fresh() {
  await ensureAppDatabase();
  await dropPostgresTablesAsAdmin(tables, {
    runtimeUrl: process.env.DATABASE_URL ?? "",
    migrationUrl: process.env.MIGRATION_DATABASE_URL,
  });
  await migrate();
}

/** The CLI calls this after fresh() so pooled drivers do not hold the process open. */
export async function close() {
  await closeDatabase();
}

if (import.meta.main) {
  await fresh();
  console.log("Database reset, migrated, and seeded.");
  await close();
  process.exit(0);
}
