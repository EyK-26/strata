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

  const mod = await importHiroappModule<{ status?: () => Promise<void> }>("src/db/status.ts");
  if (typeof mod.status === "function") {
    await mod.status();
  }
}

export { migrateStatusCommand };
