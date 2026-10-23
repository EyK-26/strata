import { afterEach } from "bun:test";
import assert from "node:assert/strict";
import type { DatabaseConnection } from "@getstrata/core/database/baseRepository";
import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import { Schema } from "@getstrata/core/database/schema";
import { SQL } from "bun";

const pendingCloses = new Set<() => Promise<void>>();
afterEach(async () => {
  // A setup failure happens before the original test can enter its finally.
  await Promise.all([...pendingCloses].map((close) => close()));
});

function adapter(url: string, dialect: "mysql" | "postgres") {
  if (dialect === "mysql") return createMysqlConnection(url);
  const client = new SQL(url, { max: 1 });
  return {
    async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
      try {
        return [...(await client.unsafe(query, [...params]))] as T[];
      } catch (error) {
        if (error instanceof Error) {
          console.error("Native fixture SQL failure", {
            code: Reflect.get(error, "errno"),
            message: error.message,
          });
        }
        throw error;
      }
    },
    async close() {
      await client.close();
    },
  };
}
export async function createNativeFixture() {
  const dialect = process.env.QUALIFICATION_DATABASE;
  assert.ok(dialect === "mysql" || dialect === "postgres");
  const driver = dialect === "postgres" ? "pgsql" : dialect;
  const appUrl = process.env.APP_DATABASE_URL;
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  assert.ok(appUrl && migrationUrl);
  const runtime = adapter(appUrl, dialect);
  const migration: {
    withMigrationDatabase<T>(operation: (connection: DatabaseConnection) => Promise<T>): Promise<T>;
  } = await import(new URL("./src/db/migrationRuntime.ts", import.meta.url).href);
  const runSchema = (operation: Parameters<typeof Schema.run>[2]) =>
    migration.withMigrationDatabase((connection) => Schema.run(connection, driver, operation));
  let closed = false;
  const database: DatabaseConnection & { close(): Promise<void> } = {
    unsafe: (query, params) => runtime.unsafe(query, params),
    async close() {
      if (closed) return;
      closed = true;
      pendingCloses.delete(database.close);
      try {
        // Fixture DDL belongs to the existing migration owner, never the app role.
        await runSchema((schema) => {
          for (const table of [
            "nested_comments",
            "nested_videos",
            "nested_articles",
            "nested_video_owners",
            "nested_article_owners",
          ])
            schema.drop(table);
        });
      } finally {
        await runtime.close();
      }
    },
  };
  pendingCloses.add(database.close);
  if ("begin" in runtime) database.begin = runtime.begin.bind(runtime);
  return { database, runSchema, dialect };
}
