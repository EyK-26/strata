import { join } from "node:path";
import { loadMigrationsFromDirectory, rollbackDatabase } from "@getstrata/core/database/migrations";
import { connectHiroappDatabase } from "./connect.ts";

const db = await connectHiroappDatabase();
const migrations = await loadMigrationsFromDirectory(join(import.meta.dir, "migrations"));
const count = await rollbackDatabase(db, migrations, {
  onMigration: (name) => console.log(`rolled back ${name}`),
});
console.log(`Rolled back ${count} migration(s).`);
