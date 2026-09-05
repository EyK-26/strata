import { join } from "node:path";
import {
  getMigrationStatus,
  loadMigrationsFromDirectory,
} from "@getstrata/core/database/migrations";
import { connectHiroappDatabase } from "./connect.ts";

const db = await connectHiroappDatabase();
const migrations = await loadMigrationsFromDirectory(join(import.meta.dir, "migrations"));
const statuses = await getMigrationStatus(db, migrations);

if (statuses.length === 0) {
  console.log("No migration files found.");
} else {
  console.log("Migration status:");
  for (const { name, status, batch } of statuses) {
    const batchLabel = batch === null ? "-" : String(batch);
    console.log(`- [${status}] ${name} (batch: ${batchLabel})`);
  }
}
