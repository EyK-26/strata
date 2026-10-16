import { assertFixtureSchema } from "../../bootstrap/schemaTarget.ts";

/** Private framework fixture command; generated apps use their own published CLI adapters. */
async function seedCommand(): Promise<void> {
  assertFixtureSchema();
  const { seedDatabase } = await import("../../db/seeders/runner");
  await seedDatabase();
}

export { seedCommand };
