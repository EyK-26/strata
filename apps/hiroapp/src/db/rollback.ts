import { dropPostgresTablesAsAdmin } from "@getstrata/core/tenant/enableTenantRls";
import { ensureAppDatabase } from "../bootstrap/ensureDatabase.ts";

const tables = [
  "api_tokens",
  "sessions",
  "auth_saml_assertions",
  "auth_one_time_tokens",
  "users",
  "notes",
  "tenant",
];

export async function rollback() {
  await ensureAppDatabase();
  await dropPostgresTablesAsAdmin(tables, {
    runtimeUrl: process.env.DATABASE_URL ?? "",
    migrationUrl: process.env.MIGRATION_DATABASE_URL,
  });
  for (const table of tables) {
    console.log(`dropped ${table}`);
  }
}

if (import.meta.main) {
  await rollback();
  console.log("Rolled back starter tables.");
  process.exit(0);
}
