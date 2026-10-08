import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  bindDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import type { ActiveDatabaseHandle } from "@getstrata/core/database/connectionContext";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { defineModel } from "@getstrata/core/database/model";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";
import { requestTransactionRollback, runInTransaction } from "@getstrata/core/database/transaction";
import { eventBus } from "@getstrata/core/events";

type Row = {
  id: number;
  title: string;
  qty: number;
  meta: { tags: string[] };
  password: string;
  note: string | null;
  blob: Uint8Array;
};
const table = defineTable<Row, "id">({
  name: "dirty_items",
  primaryKey: "id",
  columns: ["id", "title", "qty", "meta", "password", "note", "blob"],
});
let connection: ReturnType<typeof createSqliteConnection>;
let writes: string[];
function model() {
  return class Item extends defineModel(table) {
    static override $guarded = [];
    static override $timestamps = false;
    static override $casts = { meta: "json", password: "hashed" } as const;
  };
}
beforeEach(async () => {
  connection = createSqliteConnection(":memory:");
  useSqlDialect("sqlite");
  await connection.unsafe(
    "CREATE TABLE dirty_items(id INTEGER PRIMARY KEY, title TEXT NOT NULL, qty INTEGER CHECK(qty >= 0), meta TEXT, password TEXT, note TEXT, blob BLOB)",
  );
  await connection.unsafe(
    "INSERT INTO dirty_items VALUES(1, 'original', 10, '{\"tags\":[\"a\"]}', '$2b$12$existing', 'note', X'0102')",
  );
  writes = [];
  bindDatabaseConnection({
    unsafe: async <T>(sql: string, params: readonly unknown[] = []) => {
      if (sql.startsWith("UPDATE")) writes.push(sql);
      return connection.unsafe<T>(sql, params);
    },
    begin: async <T>(callback: (transaction: ActiveDatabaseHandle) => Promise<T>) =>
      connection.begin((transaction) =>
        callback({
          unsafe: async <R>(sql: string, params: readonly unknown[] = []) => {
            if (sql.startsWith("UPDATE")) writes.push(sql);
            return transaction.unsafe<R>(sql, params);
          },
        }),
      ),
  } as typeof connection);
});
afterEach(() => {
  resetBoundDatabaseConnection();
  resetSqlDialect();
  connection.close();
});

describe("changed-field model writes", () => {
  test("independent edits from stale models survive and RETURNING resets the snapshot", async () => {
    const Item = model();
    const first = await Item.findOrFail(1);
    const second = await Item.findOrFail(1);
    await first.update({ title: "new title", note: null });
    await second.update({ qty: 11 });
    expect(second.toObject()).toMatchObject({ title: "new title", qty: 11, note: null });
    expect(writes[1]).not.toContain('"title" =');
    expect(writes[1]).not.toContain('"password" =');
    await second.save();
    expect(writes).toHaveLength(2);
    await first.update({ title: "final" });
    expect((await Item.findOrFail(1)).toObject()).toMatchObject({
      title: "final",
      qty: 11,
      note: null,
    });
  });

  test("no-op saves run pre-write/saved hooks but issue no SQL or updated event", async () => {
    const Item = model();
    const hooks: string[] = [];
    Item.observe({
      saving: () => hooks.push("saving"),
      updating: () => hooks.push("updating"),
      updated: () => hooks.push("updated"),
      saved: () => hooks.push("saved"),
    });
    const events: unknown[] = [];
    const stop = eventBus.listen("dirty_items.updated", (row) => {
      events.push(row);
    });
    const hash = spyOn(Bun.password, "hash").mockRejectedValue(
      new Error("unchanged password must not hash"),
    );
    try {
      const item = await Item.findOrFail(1);
      await item.save();
      expect(writes).toEqual([]);
      expect(events).toEqual([]);
      expect(hooks).toEqual(["saving", "updating", "saved"]);
      expect(hash).not.toHaveBeenCalled();
    } finally {
      stop();
      hash.mockRestore();
    }
  });

  test("JSON and binary mutations in place are detected without serialization side effects", async () => {
    const Item = model();
    const item = await Item.findOrFail(1);
    item.get("meta").tags.push("b");
    item.get("blob")[0] = 9;
    expect(item.toArray().meta).toEqual({ tags: ["a", "b"] });
    await item.save();
    const fresh = await Item.findOrFail(1);
    expect(fresh.get("meta")).toEqual({ tags: ["a", "b"] });
    expect(fresh.get("blob")[0]).toBe(9);
    await item.save();
    expect(writes).toHaveLength(1);
  });

  test("observer edits before SQL are written and edits after SQL remain dirty", async () => {
    const Item = model();
    let after = true;
    Item.observe({
      updating: (item) => item.mergeAttributes({ note: "observer" }),
      updated: (item) => {
        if (after) {
          item.mergeAttributes({ title: "after observer" });
          after = false;
        }
      },
    });
    const item = await Item.findOrFail(1);
    await item.update({ qty: 12 });
    expect((await Item.findOrFail(1)).toObject()).toMatchObject({
      qty: 12,
      note: "observer",
      title: "original",
    });
    await item.save();
    expect((await Item.findOrFail(1)).get("title")).toBe("after observer");
    await item.save();
    expect(writes).toHaveLength(2);
  });

  test("SQL and cast failures do not mark edits clean", async () => {
    const Item = model();
    const item = await Item.findOrFail(1);
    await expect(item.update({ qty: -1 })).rejects.toThrow();
    await item.update({ qty: 20 });
    const hash = spyOn(Bun.password, "hash").mockRejectedValue(new Error("cast failure"));
    try {
      await expect(item.update({ password: "plain" })).rejects.toThrow("cast failure");
    } finally {
      hash.mockRestore();
    }
    item.mergeAttributes({ password: "$2b$12$replacement" });
    await item.save();
    expect((await Item.findOrFail(1)).toObject()).toMatchObject({
      qty: 20,
      password: "$2b$12$replacement",
    });
  });

  test("observer failure rolls back writes/events and the same model can retry", async () => {
    const Item = model();
    let fail = true;
    Item.observe({
      saved: () => {
        if (fail) throw new Error("observer failure");
      },
    });
    const item = await Item.findOrFail(1);
    const events: unknown[] = [];
    const stop = eventBus.listen("dirty_items.updated", (row) => {
      events.push(row);
    });
    try {
      await expect(runInTransaction(() => item.update({ title: "retry" }))).rejects.toThrow(
        "observer failure",
      );
      expect((await Item.findOrFail(1)).get("title")).toBe("original");
      expect(events).toEqual([]);
      fail = false;
      await item.save();
      expect((await Item.findOrFail(1)).get("title")).toBe("retry");
      expect(events).toHaveLength(1);
    } finally {
      stop();
    }
  });

  test("outer rollback unwinds repeated saves and successful nested savepoints", async () => {
    const Item = model();
    const item = await Item.findOrFail(1);
    await runInTransaction(async () => {
      await item.update({ title: "first" });
      await runInTransaction(() => item.update({ qty: 12 }));
      await item.update({ title: "final" });
      requestTransactionRollback();
    });
    expect((await Item.findOrFail(1)).toObject()).toMatchObject({ title: "original", qty: 10 });
    await item.save();
    expect((await Item.findOrFail(1)).toObject()).toMatchObject({ title: "final", qty: 12 });
  });

  test("savepoint rollback restores its baseline without undoing the parent's snapshot", async () => {
    const Item = model();
    const item = await Item.findOrFail(1);
    await runInTransaction(async () => {
      await item.update({ title: "parent" });
      await expect(
        runInTransaction(async () => {
          await item.update({ qty: 14 });
          throw new Error("child rollback");
        }),
      ).rejects.toThrow("child rollback");
      expect((await Item.findOrFail(1)).get("qty")).toBe(10);
      await item.save();
      expect(writes.at(-1)).not.toContain('"title" =');
    });
    expect((await Item.findOrFail(1)).toObject()).toMatchObject({ title: "parent", qty: 14 });
  });

  test("committed writes stay clean when deferred listener delivery fails", async () => {
    const Item = model();
    const item = await Item.findOrFail(1);
    const stop = eventBus.listen("dirty_items.updated", () => {
      throw new Error("delivery failure");
    });
    try {
      await expect(runInTransaction(() => item.update({ qty: 15 }))).rejects.toThrow(
        "delivery failure",
      );
    } finally {
      stop();
    }
    await item.save();
    expect(writes).toHaveLength(1);
    expect((await Item.findOrFail(1)).get("qty")).toBe(15);
  });

  test("new instance insertion and rollback retry retain the insert contract", async () => {
    const Item = model();
    const fresh = new Item(
      {
        id: 2,
        title: "new",
        qty: 1,
        meta: { tags: [] },
        password: "$2b$12$existing",
        note: null,
        blob: new Uint8Array([3]),
      },
      Item.repository(),
      false,
    );
    await expect(
      runInTransaction(async () => {
        await fresh.save();
        throw new Error("rollback insert");
      }),
    ).rejects.toThrow("rollback insert");
    expect(fresh.$exists).toBe(false);
    await fresh.save();
    expect(fresh.$exists).toBe(true);
    await fresh.save();
    expect(writes).toEqual([]);
    expect((await Item.findOrFail(2)).get("title")).toBe("new");
  });

  test("direct atomic repository writes remain independent of a loaded instance", async () => {
    const Item = model();
    const item = await Item.findOrFail(1);
    await connection.unsafe("UPDATE dirty_items SET qty = qty + 1 WHERE id = 1");
    await item.update({ title: "kept" });
    expect((await Item.findOrFail(1)).toObject()).toMatchObject({ title: "kept", qty: 11 });
    const projected = Item.newFromRecord({ id: 1, title: "kept" });
    await projected.update({ title: "projection" });
    expect((await Item.findOrFail(1)).get("qty")).toBe(11);
  });
});
