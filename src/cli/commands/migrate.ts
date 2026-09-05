import { importHiroappModule } from "../../bootstrap/dogfoodApp.ts";
import { isFixtureSchema } from "../../bootstrap/schemaTarget.ts";

async function migrateCommand(): Promise<void> {
  if (isFixtureSchema()) {
    const { migrateDatabase } = await import("../../db/migrations/runner");
    await migrateDatabase();
    return;
  }

  await importHiroappModule("src/db/migrate.ts");
}

export { migrateCommand };
