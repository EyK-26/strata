import { migrateDatabase } from "../../db/migrations/runner";

async function migrateCommand(): Promise<void> {
  await migrateDatabase();
}

export { migrateCommand };
