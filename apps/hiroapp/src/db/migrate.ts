import { join } from "node:path";
import { loadMigrationsFromDirectory, migrateDatabase } from "@getstrata/core/database/migrations";
import { bindDatabase } from "../bootstrap/database.ts";

const db = bindDatabase();
const migrations = await loadMigrationsFromDirectory(join(import.meta.dir, "migrations"));
const count = await migrateDatabase(db, migrations, {
  advisoryLock: true,
  onMigration: (name) => console.log(`migrated ${name}`),
});
console.log(`Applied ${count} migration(s).`);
