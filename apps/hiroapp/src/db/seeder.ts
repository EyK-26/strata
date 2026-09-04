import { join } from "node:path";
import { runSeedersFromDirectory } from "@getstrata/core/database/seeders";
import { bindDatabase } from "../bootstrap/database.ts";

export async function runAppSeeders() {
  const db = bindDatabase();
  const count = await runSeedersFromDirectory(join(import.meta.dir, "seeders"), db, {
    onSeeder: (name) => console.log(`seeded ${name}`),
  });
  console.log(`Ran ${count} seeder(s).`);
  return count;
}
