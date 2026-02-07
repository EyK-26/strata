import { getMigrationStatus } from "../../db/migrations/runner";

async function migrateStatusCommand(): Promise<void> {
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
}

export { migrateStatusCommand };
