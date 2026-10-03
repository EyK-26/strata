import { pathToFileURL } from "node:url";
import type { StrataAppConfig } from "../types.ts";

type MigrateModule = {
  migrate?: (...args: string[]) => Promise<void> | void;
  seed?: (...args: string[]) => Promise<void> | void;
  fresh?: (...args: string[]) => Promise<void> | void;
  close?: () => Promise<void> | void;
};

async function importEntry(path: string): Promise<MigrateModule> {
  return (await import(pathToFileURL(path).href)) as MigrateModule;
}

/**
 * Pooled drivers such as mysql2 keep the event loop alive, so a migrate that
 * finished its work would otherwise hang until the process is killed.
 */
async function closeEntry(entry: MigrateModule): Promise<void> {
  if (typeof entry.close === "function") {
    await entry.close();
  }
}

async function migrateCommand(app: StrataAppConfig, args: string[]): Promise<void> {
  if (!app.migrate) {
    throw new Error(
      "No migrate entry found. Add src/db/migrate.ts or set migrate in strata.config.ts.",
    );
  }

  const entry = await importEntry(app.migrate);
  if (typeof entry.migrate !== "function") {
    throw new Error(`${app.migrate} must export a migrate() function.`);
  }
  if (args.includes("--seed") && typeof entry.seed !== "function") {
    throw new Error("--seed requires a seed() export on the migration entry.");
  }

  try {
    await entry.migrate(...args);

    if (args.includes("--seed") && typeof entry.seed === "function") {
      await entry.seed(...args);
    }
  } finally {
    await closeEntry(entry);
  }
  console.log("Migrations applied.");
}

async function migrateFreshCommand(app: StrataAppConfig, args: string[]): Promise<void> {
  if (app.fresh) {
    const entry = await importEntry(app.fresh);
    if (typeof entry.fresh !== "function") {
      throw new Error(`${app.fresh} must export a fresh() function.`);
    }
    const seedEntry = args.includes("--seed")
      ? typeof entry.seed === "function"
        ? entry
        : app.migrate
          ? await importEntry(app.migrate)
          : undefined
      : undefined;
    if (args.includes("--seed") && typeof seedEntry?.seed !== "function") {
      throw new Error("--seed requires a seed() export on the migration or fresh entry.");
    }
    try {
      await entry.fresh(...args);
      if (seedEntry?.seed) {
        await seedEntry.seed(...args);
      }
    } finally {
      await closeEntry(entry);
      if (seedEntry && seedEntry !== entry) await closeEntry(seedEntry);
    }
    console.log("Database reset and migrated.");
    return;
  }

  throw new Error(
    "No migrate:fresh entry found. Add src/db/fresh.ts or register a migrate:fresh command.",
  );
}

export { migrateCommand, migrateFreshCommand };
