import { assertFixtureSchema } from "../../bootstrap/schemaTarget.ts";

/** Private framework fixture command; generated apps use their own published CLI adapters. */
async function rollbackCommand(): Promise<void> {
  assertFixtureSchema();
  const { rollbackDatabase } = await import("../../db/migrations/runner");
  await rollbackDatabase();
}

export { rollbackCommand };
