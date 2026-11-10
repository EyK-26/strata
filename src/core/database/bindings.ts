import { CORE_EXECUTION_CONTEXT_TOKEN } from "@getstrata/core/contracts/executionContext";
import { CORE_EXECUTION_OPERATIONS_TOKEN } from "@getstrata/core/contracts/executionOperations";
import { CORE_EXECUTION_OWNERSHIP_TOKEN } from "@getstrata/core/contracts/executionOwnership";
import {
  resourceService,
  type ServiceDeclaration,
  service,
} from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { PersistenceError } from "@getstrata/core/database/errors";
import { DATABASE_MANAGER_TOKEN, DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { copyApplicationConfig } from "../config/configSnapshot";
import type { OpenOutcome } from "../contracts/application";
import type { DatabaseConnectionOptions, DatabaseDefinition, RawPool } from "./driverPorts";
import { DatabaseManager } from "./manager";
import { createRawMysqlPool } from "./rawMysql";
import { createRawPostgresPool } from "./rawPostgres";
import { openRawSqlitePool } from "./rawSqlite";
import { createDatabaseSession } from "./sessionFactory";

function invalid(): never {
  throw new PersistenceError("DATABASE_CONFIG_INVALID");
}
function record(input: unknown, allowed?: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return invalid();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || (allowed && !allowed.includes(key))) return invalid();
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return invalid();
    result[key] = descriptor.value;
  }
  return result;
}
function nonempty(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) invalid();
}
function integer(value: unknown, minimum: number): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) invalid();
}
function connectionOptions(input: unknown): DatabaseConnectionOptions {
  const all = record(input);
  if (all.driver === "sqlite") {
    if (Object.keys(all).some((key) => !["driver", "filename"].includes(key))) invalid();
    nonempty(all.filename);
    return all as DatabaseConnectionOptions;
  }
  if (all.driver !== "pgsql" && all.driver !== "mysql") return invalid();
  const allowed =
    all.driver === "pgsql"
      ? ["driver", "url", "max", "idleTimeout", "maxLifetime", "connectionTimeout"]
      : ["driver", "url", "max"];
  if (Object.keys(all).some((key) => !allowed.includes(key))) invalid();
  const options = Object.fromEntries(
    Object.entries(all).filter(([, value]) => value !== undefined),
  );
  nonempty(options.url);
  try {
    const url = new URL(options.url);
    if (
      !(all.driver === "mysql" ? ["mysql:"] : ["postgres:", "postgresql:"]).includes(url.protocol)
    )
      return invalid();
  } catch {
    return invalid();
  }
  if (options.max !== undefined) integer(options.max, 1);
  for (const key of ["idleTimeout", "maxLifetime", "connectionTimeout"]) {
    const value = options[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0))
      invalid();
  }
  return options as DatabaseConnectionOptions;
}
function snapshotDatabaseDefinition(input: DatabaseDefinition): DatabaseDefinition {
  const definition = record(input, ["default", "connections"]);
  nonempty(definition.default);
  const connections = record(definition.connections);
  const copied: Record<string, DatabaseConnectionOptions> = Object.create(null);
  for (const [name, options] of Object.entries(connections)) {
    nonempty(name);
    copied[name] = connectionOptions(options);
  }
  if (!Object.hasOwn(copied, definition.default)) invalid();
  return copyApplicationConfig({
    default: definition.default,
    connections: copied,
  }) as DatabaseDefinition;
}
async function openPool(options: DatabaseConnectionOptions): Promise<OpenOutcome<RawPool>> {
  switch (options.driver) {
    case "sqlite":
      return openRawSqlitePool(options);
    case "pgsql":
      return { ok: true, value: await createRawPostgresPool(options) };
    case "mysql":
      return { ok: true, value: await createRawMysqlPool(options) };
  }
}

/** Every configured pool has its own declaration and journal acquisition. */
function createDatabaseBindings(definition: DatabaseDefinition): readonly ServiceDeclaration[] {
  const snapshot = snapshotDatabaseDefinition(definition);
  const entries = Object.entries(snapshot.connections).map(([name, options]) => ({
    name,
    options,
    token: createServiceToken<RawPool>(`core.database.pool.${name}`),
  }));
  const poolTokens = entries.map((entry) => entry.token);
  const declarations: ServiceDeclaration[] = entries.map(({ name, options, token }) =>
    resourceService(token, {
      lifetime: "application",
      dependencies: [] as const,
      create: () => ({
        name: `core.database.pool.${name}`,
        open: () => openPool(options),
        close: (pool) => pool.close(),
      }),
    }),
  );
  declarations.push(
    service(DATABASE_MANAGER_TOKEN, {
      lifetime: "application",
      dependencies: poolTokens,
      create: (...pools) =>
        new DatabaseManager(
          snapshot.default,
          entries.map(({ name }, index) => [name, pools[index] as RawPool] as const),
        ),
    }),
  );
  declarations.push(
    service(DATABASE_SESSION_TOKEN, {
      lifetime: "execution",
      dependencies: [
        DATABASE_MANAGER_TOKEN,
        CORE_EXECUTION_CONTEXT_TOKEN,
        CORE_EXECUTION_OPERATIONS_TOKEN,
        CORE_EXECUTION_OWNERSHIP_TOKEN,
      ] as const,
      create: (manager, context, operations, ownership) =>
        createDatabaseSession(manager, context, operations, ownership),
    }),
  );
  return Object.freeze(declarations);
}

export type { DatabaseConnectionOptions, DatabaseDefinition };
export { createDatabaseBindings };
