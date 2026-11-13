import { describe, expect, test } from "bun:test";
import { currentSqlDialect, runWithSqlDialect } from "@getstrata/core/database/dialect";
import { freshDatabase, migrateDatabase } from "@getstrata/core/database/migrations/runner";
import type { MigrationDatabase } from "@getstrata/core/database/migrations/types";
import {
  createSchemaBuilder,
  resolveDatabaseDriver,
  Schema,
} from "@getstrata/core/database/schema";
import { restoreEnvVar } from "../../../helpers/restoreEnv";

const build = () =>
  Schema.builder().create("owned", (table) => {
    table.id();
  });

describe("schema dialect ownership", () => {
  test("implicit builders and migrations reject missing context before database effects", async () => {
    let effects = 0;
    const db: MigrationDatabase = {
      async unsafe<T>() {
        effects++;
        return [] as T[];
      },
    };
    expect(() => Schema.builder()).toThrow("SQL dialect context is required");
    expect(() => createSchemaBuilder(db)).toThrow("SQL dialect context is required");
    for (const advisoryLock of [false, true]) {
      await expect(migrateDatabase(db, [], { advisoryLock })).rejects.toThrow(
        "SQL dialect context is required",
      );
      await expect(freshDatabase(db, [], { advisoryLock })).rejects.toThrow(
        "SQL dialect context is required",
      );
    }
    expect(effects).toBe(0);
  });

  test("explicit builders work without a context and retain their driver after context exits", () => {
    const mysql = runWithSqlDialect("pgsql", () => Schema.builder("mysql"));
    mysql.create("owned", (table) => {
      table.id();
    });
    expect(mysql.toSql()[0]).toContain("`owned`");
    const postgres = runWithSqlDialect("pgsql", () => Schema.builder());
    runWithSqlDialect("mysql", () =>
      postgres.create("owned", (table) => {
        table.id();
      }),
    );
    expect(postgres.toSql()[0]).toContain('"id" SERIAL');
    expect(() => currentSqlDialect()).toThrow("SQL dialect context is required");
  });

  test("concurrent schema builders and commits use their own driver across awaits", async () => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const results = await Promise.all([
      runWithSqlDialect("pgsql", async () => {
        await ready;
        return build().toSql();
      }),
      runWithSqlDialect("mysql", async () => {
        const statements: string[] = [];
        const db: MigrationDatabase = {
          async unsafe<T>(sql: string) {
            statements.push(sql);
            return [] as T[];
          },
        };
        const builder = createSchemaBuilder(db);
        release();
        await Promise.resolve();
        builder.create("owned", (table) => {
          table.id();
        });
        await builder.execute(db);
        return statements;
      }),
    ]);
    expect(results[0]?.[0]).toContain('"id" SERIAL PRIMARY KEY');
    expect(results[1]?.[0]).toContain("`id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY");
    expect(() => Schema.builder()).toThrow("SQL dialect context is required");
  });

  test("driver resolution uses only explicit options, including URL and normalized aliases", () => {
    const previousConnection = process.env.DB_CONNECTION;
    const previousUrl = process.env.DATABASE_URL;
    process.env.DB_CONNECTION = "mysql";
    process.env.DATABASE_URL = "mysql://ambient/database";
    try {
      expect(() => resolveDatabaseDriver({})).toThrow("explicit database connection");
      expect(resolveDatabaseDriver({ connection: " PostgreSQL " })).toBe("pgsql");
      expect(resolveDatabaseDriver({ connection: "mariadb", url: "sqlite:ignored" })).toBe("mysql");
      for (const url of [
        "postgres://host/database",
        "postgresql://host/database",
        "postgres:database",
      ]) {
        expect(resolveDatabaseDriver({ url })).toBe("pgsql");
      }
      expect(resolveDatabaseDriver({ url: "mysql://host/database" })).toBe("mysql");
      expect(resolveDatabaseDriver({ url: "sqlite::memory:" })).toBe("sqlite");
      expect(() => resolveDatabaseDriver({ connection: "unknown" })).toThrow(
        "Unsupported DB_CONNECTION",
      );
      expect(() => resolveDatabaseDriver({ url: "https://host/database" })).toThrow(
        "explicit database connection",
      );
    } finally {
      restoreEnvVar("DB_CONNECTION", previousConnection);
      restoreEnvVar("DATABASE_URL", previousUrl);
    }
  });
});
