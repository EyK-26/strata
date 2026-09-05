import { type ActiveDatabaseHandle, runWithDatabaseConnection } from "./connectionContext.ts";
import { runWithSqlDialect } from "./dialect.ts";
import type { DatabaseDriver } from "./schema/driver.ts";

type NamedConnectionEntry = {
  name: string;
  driver: DatabaseDriver;
  connection: ActiveDatabaseHandle;
};

const REGISTRY_KEY = Symbol.for("@getstrata/namedConnections");

function registry(): Map<string, NamedConnectionEntry> {
  const globalRecord = globalThis as Record<symbol, Map<string, NamedConnectionEntry> | undefined>;
  const existing = globalRecord[REGISTRY_KEY];
  if (existing) {
    return existing;
  }
  const created = new Map<string, NamedConnectionEntry>();
  globalRecord[REGISTRY_KEY] = created;
  return created;
}

function registerNamedConnection(
  name: string,
  driver: DatabaseDriver,
  connection: ActiveDatabaseHandle,
): void {
  if (!name.trim()) {
    throw new Error("Named database connection requires a non-empty name.");
  }
  registry().set(name, { name, driver, connection });
}

function unregisterNamedConnection(name: string): boolean {
  return registry().delete(name);
}

function hasNamedConnection(name: string): boolean {
  return registry().has(name);
}

function getNamedConnection(name: string): NamedConnectionEntry {
  const entry = registry().get(name);
  if (!entry) {
    throw new Error(`Named database connection "${name}" is not registered.`);
  }
  return entry;
}

function resetNamedConnections(): void {
  registry().clear();
}

function runOnNamedConnection<T>(name: string, callback: () => T | Promise<T>): T | Promise<T> {
  const entry = getNamedConnection(name);
  return runWithSqlDialect(entry.driver, () =>
    runWithDatabaseConnection(entry.connection, callback),
  );
}

export type { NamedConnectionEntry };
export {
  getNamedConnection,
  hasNamedConnection,
  registerNamedConnection,
  resetNamedConnections,
  runOnNamedConnection,
  unregisterNamedConnection,
};
