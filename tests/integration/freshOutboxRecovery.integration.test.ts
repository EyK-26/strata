import { expect, test } from "bun:test";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import {
  freshDatabase,
  migrateDatabase,
  rollbackDatabase,
} from "@getstrata/core/database/migrations/runner";
import type { Migration, MigrationDatabase } from "@getstrata/core/database/migrations/types";
import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import { Schema } from "@getstrata/core/database/schema";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { createOutboxMigration } from "@getstrata/core/events/outbox";
import { SQL } from "bun";

type Driver = "sqlite" | "pgsql" | "mysql";

async function fixture(driver: Driver, run: (db: MigrationDatabase) => Promise<void>) {
  useSqlDialect(driver);
  if (driver === "sqlite") {
    const db = createSqliteConnection(":memory:");
    try {
      await run(db);
    } finally {
      db.close();
      resetSqlDialect();
    }
    return;
  }
  const source =
    driver === "pgsql"
      ? process.env.MIGRATION_DATABASE_URL
      : process.env.MYSQL_OBSERVABILITY_ADMIN_URL;
  if (!source) throw new Error("Missing disposable database admin URL");
  const name = `fresh_${crypto.randomUUID().replaceAll("-", "")}`;
  const control = driver === "pgsql" ? new SQL(source) : createMysqlConnection(source);
  let database: typeof control | undefined;
  let created = false;
  try {
    await control.unsafe(`CREATE DATABASE ${name}`);
    created = true;
    const url = new URL(source);
    url.pathname = `/${name}`;
    database = driver === "pgsql" ? new SQL(url.href) : createMysqlConnection(url.href);
    await run(database);
  } finally {
    await database?.close();
    if (created)
      await control.unsafe(`DROP DATABASE ${name}${driver === "pgsql" ? " WITH (FORCE)" : ""}`);
    await control.close();
    resetSqlDialect();
  }
}

for (const driver of ["sqlite", "pgsql", "mysql"] as const) {
  const enabled =
    driver === "sqlite" ||
    Boolean(
      driver === "pgsql"
        ? process.env.MIGRATION_DATABASE_URL
        : process.env.MYSQL_OBSERVABILITY_ADMIN_URL,
    );
  test.skipIf(!enabled)(
    `${driver}: each unfinished outbox state protects rollback/legacy reset; explicit fresh discards it`,
    async () => {
      await fixture(driver, async (db) => {
        const outbox = createOutboxMigration("outbox", driver);
        await migrateDatabase(db, [outbox]);
        const bind = driver === "pgsql" ? ["$1", "$2"] : ["?", "?"];
        for (const state of ["pending", "processing", "failed", "completed"]) {
          await db.unsafe(
            `INSERT INTO strata_outbox_event (id,name,version,payload,created_at,publication_token) VALUES (${bind[0]},'fixture',1,'{}',0,${bind[1]})`,
            [state, state],
          );
          await db.unsafe(
            `INSERT INTO strata_outbox_delivery (event_id,listener_name,status,max_attempts,available_at) VALUES (${bind[0]},'fixture',${bind[1]},3,0)`,
            [state, state],
          );
          if (state !== "completed") {
            await expect(rollbackDatabase(db, [outbox])).rejects.toThrow("undelivered");
            await expect(freshDatabase(db, [outbox])).rejects.toThrow("undelivered");
            expect((await db.unsafe("SELECT id FROM strata_outbox_event")).length).toBe(1);
            expect((await db.unsafe("SELECT name FROM framework_migrations")).length).toBe(1);
            await freshDatabase(db, [outbox], { destructive: true });
            expect(await db.unsafe("SELECT id FROM strata_outbox_event")).toEqual([]);
            expect(await db.unsafe("SELECT event_id FROM strata_outbox_delivery")).toEqual([]);
          } else {
            // Completed deliveries permit ordinary rollback, not just an empty table.
            expect(await rollbackDatabase(db, [outbox])).toBe(1);
            expect(await migrateDatabase(db, [outbox])).toBe(1);
          }
        }
        await freshDatabase(db, [outbox], { destructive: true });
        await freshDatabase(db, [outbox], { destructive: true });
      });
    },
    30000,
  );

  test.skipIf(!enabled)(
    `${driver}: failed fresh records completed downs so migrate restores missing schema before retry`,
    async () => {
      await fixture(driver, async (db) => {
        let refused = true;
        const migrations: Migration[] = [
          createOutboxMigration("outbox", driver),
          {
            name: "refusal",
            async up() {},
            async down() {
              if (refused) throw new Error("Injected refusal");
            },
          },
          {
            name: "later",
            async up(connection) {
              await Schema.run(connection, driver, (schema) => {
                schema.create("later_fixture", (table) => {
                  table.id();
                });
              });
            },
            async down(connection) {
              await Schema.run(connection, driver, (schema) => {
                schema.drop("later_fixture");
              });
            },
          },
        ];
        await migrateDatabase(db, migrations);
        await expect(freshDatabase(db, migrations, { destructive: true })).rejects.toThrow(
          "Injected refusal",
        );
        expect(await db.unsafe("SELECT name FROM framework_migrations ORDER BY name")).toEqual([
          { name: "outbox" },
          { name: "refusal" },
        ]);
        await expect(
          (async () => await db.unsafe("SELECT id FROM later_fixture"))(),
        ).rejects.toThrow();
        expect(await migrateDatabase(db, migrations)).toBe(1);
        expect(await db.unsafe("SELECT id FROM later_fixture")).toEqual([]);
        refused = false;
        await freshDatabase(db, migrations, { destructive: true });
        expect((await db.unsafe("SELECT name FROM framework_migrations")).length).toBe(3);
        await freshDatabase(db, migrations, { destructive: true });
      });
    },
    30000,
  );
}
