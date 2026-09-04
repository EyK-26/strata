import { importHiroappModule, readDogfoodApp } from "../../bootstrap/dogfoodApp.ts";

async function migrateCommand(): Promise<void> {
  if (readDogfoodApp() === "hiroapp") {
    await importHiroappModule("src/db/migrate.ts");
    return;
  }

  const { migrateDatabase } = await import("../../db/migrations/runner");
  await migrateDatabase();
}

export { migrateCommand };
