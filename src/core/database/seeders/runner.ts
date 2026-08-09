import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Seeder, SeederDatabase } from "./types.ts";

async function loadSeedersFromDirectory(directory: string): Promise<Seeder[]> {
  const entries = await readdir(directory);
  const seederFiles = entries
    .filter(
      (entry) =>
        (entry.endsWith(".ts") || entry.endsWith(".js")) &&
        entry !== "types.ts" &&
        entry !== "index.ts" &&
        entry !== "runner.ts",
    )
    .sort();

  const loadedSeeders = await Promise.all(
    seederFiles.map(async (fileName) => {
      const moduleUrl = pathToFileURL(join(directory, fileName)).href;
      const module = (await import(moduleUrl)) as { default: Seeder };
      return module.default;
    }),
  );

  return loadedSeeders.filter((seeder): seeder is Seeder => seeder?.name !== undefined);
}

async function runSeedersFromDirectory(
  directory: string,
  db: SeederDatabase,
  options?: { onSeeder?: (name: string) => void },
): Promise<number> {
  const seeders = await loadSeedersFromDirectory(directory);

  if (seeders.length === 0) {
    return 0;
  }

  for (const seeder of seeders) {
    options?.onSeeder?.(seeder.name);
    await seeder.run(db);
  }

  return seeders.length;
}

export { loadSeedersFromDirectory, runSeedersFromDirectory };
