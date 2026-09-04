import { join } from "node:path";
import { loadMigrationsFromDirectory, migrateDatabase } from "@getstrata/core/database/migrations";
import { connectHiroappDatabase } from "./connect.ts";

const db = await connectHiroappDatabase();
const migrations = await loadMigrationsFromDirectory(join(import.meta.dir, "migrations"));
const count = await migrateDatabase(db, migrations, {
  advisoryLock: true,
  onMigration: (name) => console.log(`migrated ${name}`),
});
console.log(`Applied ${count} migration(s).`);
