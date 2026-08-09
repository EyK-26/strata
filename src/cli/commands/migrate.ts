import { importHiroappModule } from "../../bootstrap/dogfoodApp.ts";
import { isFixtureSchema } from "../../bootstrap/schemaTarget.ts";

async function migrateCommand(): Promise<void> {
  if (isFixtureSchema()) {
    const { migrateDatabase } = await import("../../db/migrations/runner");
    await migrateDatabase();
    return;
  }

  const mod = await importHiroappModule<{
    migrate?: () => Promise<void>;
    seed?: () => Promise<void>;
  }>("src/db/migrate.ts");
  if (typeof mod.migrate === "function") {
    await mod.migrate();
  }
  if (typeof mod.seed === "function") {
    await mod.seed();
  }
}

export { migrateCommand };
