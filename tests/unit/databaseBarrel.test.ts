import { describe, expect, test } from "bun:test";
import * as databaseBarrel from "../../src/core/database/index.ts";

describe("@getstrata/core/database barrel", () => {
  test("every runtime export resolves to a defined value", () => {
    const undefinedExports = Object.entries(databaseBarrel)
      .filter(([, value]) => value === undefined)
      .map(([name]) => name);

    expect(undefinedExports).toEqual([]);
  });

  test("exposes the documented database entry points", () => {
    const exported = new Map<string, unknown>(Object.entries(databaseBarrel));

    for (const name of [
      "BaseRepository",
      "Model",
      "ModelQuery",
      "Factory",
      "defineFactory",
      "Schema",
      "createDatabaseConnection",
      "runWithSqlDialect",
      "currentSqlDialect",
      "defineTable",
      "mapDatabaseError",
    ]) {
      expect(exported.has(name)).toBe(true);
      expect(exported.get(name)).toBeDefined();
    }
  });

  test("keeps constructor and Factory namespace exports callable", () => {
    const exported = new Map<string, unknown>(Object.entries(databaseBarrel));

    for (const name of ["BaseRepository", "Model", "Factory"]) {
      expect(typeof exported.get(name)).toBe("function");
    }
  });
});

test("database barrel excludes ambient database owners", () => {
  for (const name of [
    "useSqlDialect",
    "resetSqlDialect",
    "runInTransaction",
    "isActiveTransactionConnection",
    "hasActiveTransaction",
    "requestTransactionRollback",
    "afterCommit",
    "getNamedConnection",
    "hasNamedConnection",
    "registerNamedConnection",
    "resetNamedConnections",
    "runOnNamedConnection",
    "unregisterNamedConnection",
    "getDefaultDatabasePool",
    "registerDefaultDatabasePool",
    "bindDatabaseConnection",
    "repositoryConnection",
    "bindBunSql",
  ])
    expect(name in databaseBarrel).toBe(false);
});
