import { expect, test } from "bun:test";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import {
  freshDatabase,
  migrateDatabase,
  rollbackDatabase,
} from "@getstrata/core/database/migrations/runner";
import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { createOutboxMigration } from "@getstrata/core/events/outbox";

test("pending outbox protects rollback/legacy reset but explicit fresh discards all delivery states", async () => {
  const db = createSqliteConnection(":memory:");
  const outbox = createOutboxMigration("outbox", "sqlite");
  try {
    useSqlDialect("sqlite");
    await migrateDatabase(db, [outbox]);
    for (const state of ["pending", "processing", "failed", "completed"]) {
      await db.unsafe(
        "INSERT INTO strata_outbox_event (id,name,version,payload,created_at,publication_token) VALUES (?,?,1,'{}',0,?)",
        [state, "fixture", state],
      );
      await db.unsafe(
        "INSERT INTO strata_outbox_delivery (event_id,listener_name,status,max_attempts,available_at) VALUES (?,'fixture',?,3,0)",
        [state, state],
      );
    }
    await expect(rollbackDatabase(db, [outbox])).rejects.toThrow("undelivered");
    await expect(freshDatabase(db, [outbox])).rejects.toThrow("undelivered");
    expect((await db.unsafe("SELECT id FROM strata_outbox_event")).length).toBe(4);
    await freshDatabase(db, [outbox], { destructive: true });
    expect(await db.unsafe("SELECT id FROM strata_outbox_event")).toEqual([]);
    expect(await db.unsafe("SELECT event_id FROM strata_outbox_delivery")).toEqual([]);
    await freshDatabase(db, [outbox], { destructive: true });
    // Ordinary rollback is still allowed after all work completes.
    await rollbackDatabase(db, [outbox]);
  } finally {
    db.close();
    resetSqlDialect();
  }
});

test("failed fresh records completed downs so migrate restores missing schema before retry", async () => {
  const db = createSqliteConnection(":memory:");
  let refused = true;
  const migrations: Migration[] = [
    createOutboxMigration("outbox", "sqlite"),
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
        await Schema.run(connection, "sqlite", (schema) => {
          schema.create("later_fixture", (table) => {
            table.id();
          });
        });
      },
      async down(connection) {
        await Schema.run(connection, "sqlite", (schema) => {
          schema.drop("later_fixture");
        });
      },
    },
  ];
  try {
    useSqlDialect("sqlite");
    await migrateDatabase(db, migrations);
    await expect(freshDatabase(db, migrations, { destructive: true })).rejects.toThrow(
      "Injected refusal",
    );
    expect(await db.unsafe("SELECT name FROM framework_migrations ORDER BY name")).toEqual([
      { name: "outbox" },
      { name: "refusal" },
    ]);
    await expect(db.unsafe("SELECT id FROM later_fixture")).rejects.toThrow();
    expect(await migrateDatabase(db, migrations)).toBe(1);
    expect(await db.unsafe("SELECT id FROM later_fixture")).toEqual([]);
    refused = false;
    await freshDatabase(db, migrations, { destructive: true });
    expect((await db.unsafe("SELECT name FROM framework_migrations")).length).toBe(3);
    await freshDatabase(db, migrations, { destructive: true });
  } finally {
    db.close();
    resetSqlDialect();
  }
});
