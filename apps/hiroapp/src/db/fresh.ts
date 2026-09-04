import { join } from "node:path";
import { freshDatabase, loadMigrationsFromDirectory } from "@getstrata/core/database/migrations";
import { connectHiroappDatabase } from "./connect.ts";

const db = await connectHiroappDatabase();
const migrations = await loadMigrationsFromDirectory(join(import.meta.dir, "migrations"));
await freshDatabase(db, migrations, {
  advisoryLock: true,
  onMigration: (name) => console.log(`fresh ${name}`),
});
console.log("Database refreshed.");
