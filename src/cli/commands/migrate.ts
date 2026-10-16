import { assertFixtureSchema } from "../../bootstrap/schemaTarget.ts";

/** Private framework fixture command; generated apps use their own published CLI adapters. */
async function migrateCommand(): Promise<void> {
  assertFixtureSchema();
  const { migrateDatabase } = await import("../../db/migrations/runner");
  await migrateDatabase();
}

export { migrateCommand };
