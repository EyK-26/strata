import { join } from "node:path";
import { freshDatabase, loadMigrationsFromDirectory } from "@getstrata/core/database/migrations";
import { bindDatabase } from "../bootstrap/database.ts";

const db = bindDatabase();
const migrations = await loadMigrationsFromDirectory(join(import.meta.dir, "migrations"));
await freshDatabase(db, migrations, {
  advisoryLock: true,
  onMigration: (name) => console.log(`fresh ${name}`),
});
console.log("Database refreshed.");
