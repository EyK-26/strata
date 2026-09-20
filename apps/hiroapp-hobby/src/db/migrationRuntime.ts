import { join } from "node:path";
import { loadMigrationsFromDirectory } from "@getstrata/core/database/migrations/runner";
import type { MigrationDatabase } from "@getstrata/core/database/migrations/types";
import { getSql } from "../bootstrap/database.ts";

const MIGRATIONS_DIRECTORY = join(import.meta.dir, "migrations");

export async function loadStarterMigrations() {
  return loadMigrationsFromDirectory(MIGRATIONS_DIRECTORY);
}

export async function withMigrationDatabase<T>(
  fn: (db: MigrationDatabase) => Promise<T>,
): Promise<T> {
  return fn(getSql());
}
