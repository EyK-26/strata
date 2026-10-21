import { afterEach, describe, expect, test } from "bun:test";
import {
  bindDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { defineModel, ModelQuery } from "@getstrata/core/database/model";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";

type Row = { id: number; scope: string; label: string };
const table = defineTable<Row, "id">({
  name: "query_contract_rows",
  primaryKey: "id",
  columns: ["id", "scope", "label"],
});
const connections: Array<ReturnType<typeof createSqliteConnection>> = [];
afterEach(() => {
  resetBoundDatabaseConnection();
  resetSqlDialect();
  for (const connection of connections.splice(0)) connection.close();
});
async function database() {
  const connection = createSqliteConnection(":memory:");
  connections.push(connection);
  useSqlDialect("sqlite");
  bindDatabaseConnection(connection);
  await connection.unsafe(
    "CREATE TABLE query_contract_rows (id INTEGER PRIMARY KEY, scope TEXT, label TEXT)",
  );
  await connection.unsafe(
    "INSERT INTO query_contract_rows VALUES (1,'visible','first'),(2,'hidden','second'),(3,'visible','third')",
  );
  return connection;
}

describe("public Model query and projection contracts", () => {
  test("projections remain plain records while full query pages retain subclass identity and retrieved hooks", async () => {
    await database();
    const retrieved: number[] = [];
    class Entry extends defineModel(table) {
      static override boot() {
        Entry.addGlobalScope<Row, "id">("visible", (query) => query.where({ scope: "visible" }));
        Entry.observe({ retrieved: (model) => retrieved.push(Number(model.id)) });
      }
      label() {
        return this.get("label");
      }
    }
    const orderBy = [{ column: "id", direction: "asc" }] as const;
    const projected = await Entry.query().select("label").keysetPaginate({ perPage: 1, orderBy });
    expect(projected.data).toEqual([{ label: "first" }]);
    expect(projected.data[0]).not.toHaveProperty("save");
    expect(projected.meta.next_cursor).toBeTruthy();
    expect(retrieved).toEqual([]);
    const second = await Entry.query()
      .select("label")
      .keysetPaginate({
        perPage: 1,
        orderBy,
        cursor: projected.meta.next_cursor ?? undefined,
      });
    expect(second.data).toEqual([{ label: "third" }]);
    const models = await Entry.query().keysetPaginate({ perPage: 1, orderBy });
    expect(models.data[0]).toBeInstanceOf(Entry);
    expect(models.data[0]?.label()).toBe("first");
    expect(retrieved).toEqual([1]);
    expect(await Entry.where({ id: 99 }).select("label").first()).toBeNull();
  });

  test("the exported query constructor uses the supplied query and preserves thenable fulfillment and rejection", async () => {
    const connection = await database();
    class Entry extends defineModel(table) {}
    const query = new ModelQuery<Entry>(Entry, Entry.query().query);
    expect(query).toBeInstanceOf(ModelQuery);
    const rows = await query.where({ id: 3 });
    expect(Array.isArray(rows)).toBe(true);
    if (!Array.isArray(rows)) throw new Error("Thenable query did not return an array.");
    expect(rows[0]).toBeInstanceOf(Entry);
    expect(rows[0]?.get("label")).toBe("third");
    const pending = Entry.query();
    connection.close();
    connections.splice(connections.indexOf(connection), 1);
    await expect(Promise.resolve(pending)).rejects.toThrow();
  });

  test("missing records preserve null, default errors and caller-owned error identity", async () => {
    await database();
    class Entry extends defineModel(table) {}
    expect(await Entry.query().find(99)).toBeNull();
    await expect(Entry.query().findOrFail(99)).rejects.toThrow("Entry 99 not found.");
    const error = new Error("owned missing record");
    await expect(Entry.query().findOrFail(99, () => error)).rejects.toBe(error);
    expect((await Entry.query().findOrFail(1)).get("label")).toBe("first");
  });

  test("unknown relation names fail at composition instead of silently dropping constraints", async () => {
    await database();
    class Entry extends defineModel(table) {}
    for (const compose of [
      () => Entry.query().with("missing"),
      () => Entry.query().withCount("missing"),
      () => Entry.query().has("missing"),
      () => Entry.query().whereDoesntHave("missing"),
    ]) {
      expect(compose).toThrow("Entry has no relation method missing().");
    }
  });
});
