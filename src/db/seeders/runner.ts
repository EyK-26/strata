import { runSeedersFromDirectory } from "../../core/database/seeders/runner";
import type { SeederDatabase } from "../../core/database/seeders/types";
import { type FixtureSchemaOptions, withFixtureSchema } from "../fixtureSchemaOwner";

/** Compose fresh+seed on the same selected executor; no nested command owner. */
export function seedSelectedDatabase(database: SeederDatabase): Promise<number> {
  return runSeedersFromDirectory(import.meta.dir, database, {
    onSeeder: (name) => console.log(`Seeding ${name}...`),
  });
}
async function seedDatabase(options: FixtureSchemaOptions = {}): Promise<void> {
  const count = await withFixtureSchema(seedSelectedDatabase, options);
  console.log(count ? `Ran ${count} seeder(s).` : "No seeders registered.");
}

export { seedDatabase };
