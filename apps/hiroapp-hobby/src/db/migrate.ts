import { migrateDatabase } from "@getstrata/core/database/migrations";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { closeDatabase } from "../bootstrap/database.ts";
import { Note } from "../models/Note.ts";
import { loadStarterMigrations, withMigrationDatabase } from "./migrationRuntime.ts";

export async function seed() {
  if (isProductionEnv()) throw new Error("Demo seeding is disabled in production and staging.");

  if ((await Note.query().value("id")) === null) {
    await Note.create({ body: "Welcome to Strata!" });
  }
}

export async function migrate() {
  await withMigrationDatabase(async (db) => {
    await migrateDatabase(db, await loadStarterMigrations());
  });
}

/** The CLI calls this after migrate() so pooled drivers do not hold the process open. */
export async function close() {
  await closeDatabase();
}

if (import.meta.main) {
  await migrate();
  console.log("Database migrated.");
  await close();
  process.exit(0);
}
