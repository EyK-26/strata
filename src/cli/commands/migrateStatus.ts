import { importHiroappModule } from "../../bootstrap/dogfoodApp.ts";
import { isFixtureSchema } from "../../bootstrap/schemaTarget.ts";

async function migrateStatusCommand(): Promise<void> {
  if (isFixtureSchema()) {
    const { getMigrationStatus } = await import("../../db/migrations/runner");
    const statuses = await getMigrationStatus();

    if (statuses.length === 0) {
      console.log("No migration files found.");
      return;
    }

    console.log("Migration status:");

    for (const { name, status, batch } of statuses) {
      const batchLabel = batch === null ? "-" : String(batch);
      console.log(`- [${status}] ${name} (batch: ${batchLabel})`);
    }
    return;
  }

  await importHiroappModule("src/db/status.ts");
}

export { migrateStatusCommand };
