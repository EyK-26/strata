import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import db from "../connection";
import type { Seeder } from "./types";

async function loadSeeders(): Promise<Seeder[]> {
  const entries = await readdir(import.meta.dir);
  const seederFiles = entries
    .filter(
      (entry) =>
        entry.endsWith(".ts") &&
        entry !== "types.ts" &&
        entry !== "index.ts" &&
        entry !== "runner.ts",
    )
    .sort();

  const loadedSeeders = await Promise.all(
    seederFiles.map(async (fileName) => {
      const moduleUrl = pathToFileURL(join(import.meta.dir, fileName)).href;
      const module = (await import(moduleUrl)) as { default: Seeder };
      return module.default;
    }),
  );

  return loadedSeeders;
}

async function seedDatabase(): Promise<void> {
  const seeders = await loadSeeders();

  if (seeders.length === 0) {
    console.log("No seeders registered.");
    return;
  }

  for (const seeder of seeders) {
    console.log(`Seeding ${seeder.name}...`);
    await seeder.run(db);
  }

  console.log(`Ran ${seeders.length} seeder(s).`);
}

export { seedDatabase };
