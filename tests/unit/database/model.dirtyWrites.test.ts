import { describe, expect, spyOn, test } from "bun:test";
import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  type AfterCommitRepositoryListener,
  type BoundModel,
  defineModel,
  defineRepository,
  type ModelObserver,
} from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

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

class Entity extends Model<Row, "id"> {}
const Observer = createServiceToken<ModelObserver<Entity>>("dirty-observer");
const Updated = createServiceToken<AfterCommitRepositoryListener<Row>>("dirty-updated");
const repository = defineRepository({
  name: "dirty_items",
  table,
  dependencies: [],
  effects: [{ action: "updated", afterCommit: Updated }],
  create: (binding) => new BaseRepository(binding),
});
const definition = defineModel({
  name: "Item",
  repository,
  dependencies: [],
  attributes: { guarded: [], timestamps: false, casts: { meta: "json", password: "hashed" } },
  observers: [Observer],
  construct: (state, binding) => new Entity(state, binding),
});
async function withDirty(
  work: (context: {
    Item: BoundModel<Row, "id", Entity>;
    db: DatabaseSession;
    writes: string[];
    events: unknown[];
  }) => Promise<void>,
  options: { observer?: ModelObserver<Entity>; listener?: AfterCommitRepositoryListener<Row> } = {},
) {
  const writes: string[] = [];
  const events: unknown[] = [];
  await withBoundDatabase(
    {
      definition: {
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        repositories: [repository],
        models: [definition],
      },
      services: [
        valueService(Observer, options.observer ?? {}),
        valueService(
          Updated,
          options.listener ??
            ((row) => {
              events.push(row);
            }),
        ),
      ],
      observe: (statement) => {
        if (statement.text.startsWith("UPDATE")) writes.push(statement.text);
      },
    },
    async (db) => {
      await db.execute({
        text: "CREATE TABLE dirty_items(id INTEGER PRIMARY KEY, title TEXT NOT NULL, qty INTEGER CHECK(qty >= 0), meta TEXT, password TEXT, note TEXT, blob BLOB)",
        params: [],
      });
      await db.execute({
        text: "INSERT INTO dirty_items VALUES(1, 'original', 10, '{\"tags\":[\"a\"]}', '$2b$12$existing', 'note', X'0102')",
        params: [],
      });
      await work({ Item: db.model(definition), db, writes, events });
    },
  );
}

describe("changed-field model writes", () => {
  test("independent edits from stale models survive and RETURNING resets the snapshot", async () => {
    await withDirty(async ({ Item, writes }) => {
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
    }, {});
  });
  test("no-op saves run pre-write/saved hooks but issue no SQL or updated event", async () => {
    const hooks: string[] = [];
    await withDirty(
      async ({ Item, writes, events }) => {
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
          hash.mockRestore();
        }
      },
      {
        observer: {
          saving: () => hooks.push("saving"),
          updating: () => hooks.push("updating"),
          updated: () => hooks.push("updated"),
          saved: () => hooks.push("saved"),
        },
      },
    );
  });
  test("JSON and binary mutations in place are detected without serialization side effects", async () => {
    await withDirty(async ({ Item, writes }) => {
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
    }, {});
  });
  test("observer edits before SQL are written and edits after SQL remain dirty", async () => {
    let after = true;
    await withDirty(
      async ({ Item, writes }) => {
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
      },
      {
        observer: {
          updating: (item) => item.mergeAttributes({ note: "observer" }),
          updated: (item) => {
            if (after) {
              item.mergeAttributes({ title: "after observer" });
              after = false;
            }
          },
        },
      },
    );
  });
  test("SQL and cast failures do not mark edits clean", async () => {
    await withDirty(async ({ Item }) => {
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
    }, {});
  });
  test("observer failure rolls back writes/events and the rebound model can retry", async () => {
    let fail = true;
    await withDirty(
      async ({ Item, db, events }) => {
        let item = await Item.findOrFail(1);
        await expect(
          db.transaction(async (tx) => {
            item = tx.model(definition).bind(item);
            await item.update({ title: "retry" });
          }),
        ).rejects.toThrow("observer failure");
        expect((await Item.findOrFail(1)).get("title")).toBe("original");
        expect(events).toEqual([]);
        fail = false;
        item = Item.bind(item);
        await item.save();
        expect((await Item.findOrFail(1)).get("title")).toBe("retry");
        expect(events).toHaveLength(1);
      },
      {
        observer: {
          saved: () => {
            if (fail) throw new Error("observer failure");
          },
        },
      },
    );
  });
  test("outer rollback unwinds repeated saves and successful nested savepoints", async () => {
    await withDirty(async ({ Item, db }) => {
      let item = await Item.findOrFail(1);
      await db.transaction(async (parent) => {
        item = parent.model(definition).bind(item);
        await item.update({ title: "first" });
        let childItem!: Entity;
        await parent.transaction(async (child) => {
          childItem = child.model(definition).bind(item);
          await childItem.update({ qty: 12 });
        });
        // Branch entities are deliberate copies. Carry the child's intended row edits
        // back to the still-live parent entity before its next terminal write.
        item.mergeAttributes(childItem.toObject());
        await item.update({ title: "final" });
        parent.requestRollback();
      });
      expect((await Item.findOrFail(1)).toObject()).toMatchObject({ title: "original", qty: 10 });
      item = Item.bind(item);
      await item.save();
      expect((await Item.findOrFail(1)).toObject()).toMatchObject({ title: "final", qty: 12 });
    });
  });
  test("savepoint rollback restores its baseline without undoing the parent's snapshot", async () => {
    await withDirty(async ({ Item, db, writes }) => {
      const source = await Item.findOrFail(1);
      await db.transaction(async (parent) => {
        const item = parent.model(definition).bind(source);
        await item.update({ title: "parent" });
        let childItem!: Entity;
        await expect(
          parent.transaction(async (child) => {
            childItem = child.model(definition).bind(item);
            await childItem.update({ qty: 14 });
            throw new Error("child rollback");
          }),
        ).rejects.toThrow("child rollback");
        expect((await parent.model(definition).findOrFail(1)).get("qty")).toBe(10);
        item.mergeAttributes(childItem.toObject());
        await item.save();
        expect(writes.at(-1)).not.toContain('"title" =');
      });
      expect((await Item.findOrFail(1)).toObject()).toMatchObject({ title: "parent", qty: 14 });
    });
  });
  test("committed writes stay clean when deferred listener delivery fails", async () => {
    let fail = true;
    await withDirty(
      async ({ Item, db, writes }) => {
        let item = await Item.findOrFail(1);
        await expect(
          db.transaction(async (tx) => {
            item = tx.model(definition).bind(item);
            await item.update({ qty: 15 });
          }),
        ).rejects.toMatchObject({
          code: "DATABASE_POST_COMMIT_FAILED",
          data: "committed",
          cause: { message: "delivery failure" },
        });
        fail = false;
        item = Item.bind(item);
        await item.save();
        expect(writes).toHaveLength(1);
        expect((await Item.findOrFail(1)).get("qty")).toBe(15);
      },
      {
        listener: () => {
          if (fail) throw new Error("delivery failure");
        },
      },
    );
  });
  test("new instance insertion and rollback retry retain the insert contract", async () => {
    await withDirty(async ({ Item, db, writes }) => {
      let fresh = Item.newRecord({
        id: 2,
        title: "new",
        qty: 1,
        meta: { tags: [] },
        password: "$2b$12$existing",
        note: null,
        blob: new Uint8Array([3]),
      });
      await expect(
        db.transaction(async (tx) => {
          fresh = tx.model(definition).bind(fresh);
          await fresh.save();
          throw new Error("rollback insert");
        }),
      ).rejects.toThrow("rollback insert");
      expect(fresh.$exists).toBe(false);
      fresh = Item.bind(fresh);
      await fresh.save();
      expect(fresh.$exists).toBe(true);
      await fresh.save();
      expect(writes).toEqual([]);
      expect((await Item.findOrFail(2)).get("title")).toBe("new");
    });
  });
  test("direct atomic repository writes remain independent of a loaded instance", async () => {
    await withDirty(async ({ Item, db }) => {
      const item = await Item.findOrFail(1);
      await db.execute({ text: "UPDATE dirty_items SET qty = qty + 1 WHERE id = 1", params: [] });
      await item.update({ title: "kept" });
      expect((await Item.findOrFail(1)).toObject()).toMatchObject({ title: "kept", qty: 11 });
      const projected = Item.newFromTrustedRecord({ id: 1, title: "kept" });
      await projected.update({ title: "projection" });
      expect((await Item.findOrFail(1)).get("qty")).toBe(11);
    });
  });
});
