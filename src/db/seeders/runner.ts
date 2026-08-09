import { runSeedersFromDirectory } from "../../core/database/seeders/runner.ts";
import { runWithMigrationBypass } from "../../core/tenant/databaseTenantContext.ts";
import db from "../connection/index.ts";

async function seedDatabase(): Promise<void> {
  const count = await runWithMigrationBypass(async () =>
    runSeedersFromDirectory(import.meta.dir, db, {
      onSeeder: (name) => console.log(`Seeding ${name}...`),
    }),
  );

  if (count === 0) {
    console.log("No seeders registered.");
    return;
  }

  console.log(`Ran ${count} seeder(s).`);
}

export { seedDatabase };
