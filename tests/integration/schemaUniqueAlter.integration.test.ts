import { expect, test } from "bun:test";
import { Schema, UnsupportedSchemaFeatureError } from "@getstrata/core/database/schema";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";

test("SQLite rejects column-level ALTER uniqueness before executing any part of a schema plan", async () => {
  const db = createSqliteConnection(":memory:");
  try {
    await Schema.run(db, "sqlite", (schema) => {
      schema.create("invoices", (table) => {
        table.id();
        table.string("description");
      });
    });
    await db.unsafe("INSERT INTO invoices(description) VALUES (?),(?)", [
      "Příliš žluťoučký",
      "Existing invoice",
    ]);
    await expect(
      Schema.run(db, "sqlite", (schema) => {
        schema.create("must_not_exist", (table) => table.id());
        schema.table("invoices", (table) => table.string("must_not_be_added").nullable());
        schema.table("invoices", (table) => table.uuid("external_id").nullable().unique());
      }),
    ).rejects.toBeInstanceOf(UnsupportedSchemaFeatureError);
    expect(await db.unsafe("SELECT name FROM sqlite_schema WHERE name='must_not_exist'")).toEqual(
      [],
    );
    expect(
      (await db.unsafe<{ name: string }>("PRAGMA table_info(invoices)")).map((row) => row.name),
    ).toEqual(["id", "description"]);
    expect(await db.unsafe("SELECT description FROM invoices ORDER BY id")).toEqual([
      { description: "Příliš žluťoučký" },
      { description: "Existing invoice" },
    ]);
  } finally {
    await db.close?.();
  }
});

test("SQLite explicit unique-index addition preserves populated rows, nullable identities, constraints and rollback", async () => {
  const db = createSqliteConnection(":memory:");
  try {
    await Schema.run(db, "sqlite", (schema) => {
      schema.create("invoices", (table) => {
        table.id();
        table.string("description");
      });
    });
    await db.unsafe("INSERT INTO invoices(description) VALUES (?),(?)", [
      "Příliš žluťoučký",
      "Existing invoice",
    ]);
    await Schema.run(db, "sqlite", (schema) => {
      schema.table("invoices", (table) => {
        table.uuid("external_id").nullable();
        table.unique("external_id", "invoice_external_identity");
      });
    });
    expect(await db.unsafe("SELECT description, external_id FROM invoices ORDER BY id")).toEqual([
      { description: "Příliš žluťoučký", external_id: null },
      { description: "Existing invoice", external_id: null },
    ]);
    const id = crypto.randomUUID();
    await db.unsafe("UPDATE invoices SET external_id=? WHERE id=1", [id]);
    await expect(db.unsafe("UPDATE invoices SET external_id=? WHERE id=2", [id])).rejects.toThrow(
      /UNIQUE/,
    );
    await expect(
      db.unsafe("INSERT INTO invoices(description,external_id) VALUES (?,?)", ["duplicate", id]),
    ).rejects.toThrow(/UNIQUE/);
    expect(
      (await db.unsafe<{ name: string; unique: number }>("PRAGMA index_list(invoices)")).find(
        (row) => row.name === "invoice_external_identity",
      )?.unique,
    ).toBe(1);
    expect((await db.unsafe<{ n: number }>("SELECT count(*) AS n FROM invoices"))[0]?.n).toBe(2);
    await Schema.run(db, "sqlite", (schema) => {
      schema.table("invoices", (table) => table.dropIndex("invoice_external_identity"));
      schema.table("invoices", (table) => table.dropColumn("external_id"));
    });
    expect(await db.unsafe("SELECT description FROM invoices ORDER BY id")).toEqual([
      { description: "Příliš žluťoučký" },
      { description: "Existing invoice" },
    ]);
  } finally {
    await db.close?.();
  }
});

test("SQLite CREATE retains column-level UUID uniqueness", async () => {
  const db = createSqliteConnection(":memory:");
  try {
    await Schema.run(db, "sqlite", (schema) => {
      schema.create("invoices", (table) => {
        table.id();
        table.uuid("external_id").nullable().unique();
      });
    });
    const id = crypto.randomUUID();
    await db.unsafe("INSERT INTO invoices(external_id) VALUES (?),(NULL),(NULL)", [id]);
    await expect(db.unsafe("INSERT INTO invoices(external_id) VALUES (?)", [id])).rejects.toThrow(
      /UNIQUE/,
    );
    expect((await db.unsafe<{ n: number }>("SELECT count(*) AS n FROM invoices"))[0]?.n).toBe(3);
  } finally {
    await db.close?.();
  }
});
