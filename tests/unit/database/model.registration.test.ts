import { afterEach, describe, expect, test } from "bun:test";
import {
  bindDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { bootModels, defineModel } from "@getstrata/core/database/model";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";

type Row = { id: number; label: string };
const table = defineTable<Row, "id">({
  name: "registration_rows",
  primaryKey: "id",
  columns: ["id", "label"],
});
const connections: Array<ReturnType<typeof createSqliteConnection>> = [];
afterEach(() => {
  for (const connection of connections.splice(0)) connection.close();
  resetBoundDatabaseConnection();
  resetSqlDialect();
});
async function database() {
  const connection = createSqliteConnection(":memory:");
  connections.push(connection);
  bindDatabaseConnection(connection);
  useSqlDialect("sqlite");
  await connection.unsafe("CREATE TABLE registration_rows (id INTEGER PRIMARY KEY, label TEXT)");
  return connection;
}

describe("model registration and observer contracts", () => {
  test("duplicate aliases reject the whole boot list before any boot hook executes", () => {
    const boots: string[] = [];
    class First extends defineModel(table) {
      static override $morphClass = "registration-shared";
      static override boot() {
        boots.push("first");
      }
    }
    class Second extends defineModel(table) {
      static override $morphClass = "registration-shared";
      static override boot() {
        boots.push("second");
      }
    }
    expect(() => bootModels([First, Second])).toThrow(
      "Duplicate model name [registration-shared].",
    );
    expect(boots).toEqual([]);
    bootModels([First, First]);
    expect(boots).toEqual(["first"]);
  });

  test("failed boot retains pre-registered observers and discards observers from that attempt", async () => {
    await database();
    let attempts = 0;
    const hooks: string[] = [];
    class Retried extends defineModel(table) {
      static override $fillable = ["id", "label"];
      static override $timestamps = false;
      static override boot() {
        const attempt = ++attempts;
        Retried.observe({ creating: () => hooks.push(`boot-${attempt}`) });
        Retried.addGlobalScope<Row, "id">("visible", (query) => query.where({ id: 1 }));
        if (attempt === 1) throw new Error("registration boot failed");
      }
    }
    Retried.observe({ creating: () => hooks.push("before-boot") });
    expect(() => bootModels([Retried])).toThrow("registration boot failed");
    bootModels([Retried]);
    await Retried.create({ id: 1, label: "visible" });
    await Retried.create({ id: 2, label: "hidden" });
    expect(hooks).toEqual(["before-boot", "boot-2", "before-boot", "boot-2"]);
    expect((await Retried.query().get()).map((row) => row.id)).toEqual([1]);
    expect(attempts).toBe(2);
  });

  test("async observers run in order and cancellation stops later hooks before persistence", async () => {
    const connection = await database();
    const hooks: string[] = [];
    class Cancelled extends defineModel(table) {
      static override $fillable = ["id", "label"];
      static override $timestamps = false;
    }
    Cancelled.observe({
      saving: async () => {
        await Promise.resolve();
        hooks.push("first-saving");
      },
    });
    Cancelled.observe({
      saving: () => {
        hooks.push("cancel-saving");
        return false;
      },
    });
    Cancelled.observe({
      saving: () => hooks.push("later-saving"),
      creating: () => hooks.push("creating"),
      created: () => hooks.push("created"),
      saved: () => hooks.push("saved"),
    });
    await expect(Cancelled.create({ id: 1, label: "cancelled" })).rejects.toThrow(
      "Cancelled.create() was cancelled by an observer.",
    );
    expect(hooks).toEqual(["first-saving", "cancel-saving"]);
    expect(await connection.unsafe("SELECT * FROM registration_rows")).toHaveLength(0);
  });

  test("observer ownership follows the concrete class rather than its parent", async () => {
    await database();
    const hooks: string[] = [];
    class Parent extends defineModel(table) {
      static override $fillable = ["id", "label"];
      static override $timestamps = false;
    }
    class Child extends Parent {}
    Parent.observe({ creating: () => hooks.push("parent") });
    Child.observe({ creating: () => hooks.push("child") });
    await Child.create({ id: 1, label: "child" });
    await Parent.create({ id: 2, label: "parent" });
    expect(hooks).toEqual(["child", "parent"]);
    expect(Child.repository<Row, "id">()).not.toBe(Parent.repository<Row, "id">());
  });
});
