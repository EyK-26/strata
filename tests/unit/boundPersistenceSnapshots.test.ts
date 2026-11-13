import { test } from "bun:test";
import assert from "node:assert/strict";
import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { defineRepository, type RepositoryBinding } from "@getstrata/core/database/definitions";
import { defineTable } from "@getstrata/core/database/table";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import type { QueryOptions } from "@getstrata/core/database/types";
import { createApplication } from "@getstrata/core/runtime/application";
import { bounded, deferred } from "../fixtures/applicationOwnershipSupport";

type Row = { id: number; title: string };
type Gate = {
  entered: ReturnType<typeof deferred<void>>;
  release: ReturnType<typeof deferred<void>>;
};
class GatedNotes extends BaseRepository<Row, "id"> {
  #binding: RepositoryBinding<Row, "id">;
  #gate: Gate;
  constructor(binding: RepositoryBinding<Row, "id">, gate: Gate) {
    super(binding);
    this.#binding = binding;
    this.#gate = gate;
  }
  override findAll(
    options: Parameters<BaseRepository<Row, "id">["findAll"]>[0] = {},
  ): Promise<Row[]> {
    return this.#binding.run(async () => {
      this.#gate.entered.resolve();
      await this.#gate.release.promise;
      return super.findAll(options);
    });
  }
}

test("BP4 pagination snapshots nested filters, projection, joins and ordering before gated readback", async () => {
  const GateToken = createServiceToken<Gate>("bound.query.gate");
  const gate = { entered: deferred(), release: deferred() };
  const notes = defineRepository<Row, "id", GatedNotes, readonly [typeof GateToken]>({
    name: "GatedNotes",
    table: defineTable<Row, "id">({
      name: "snapshot_notes",
      primaryKey: "id",
      columns: ["id", "title"],
    }),
    dependencies: [GateToken],
    create: (binding, dependency) => new GatedNotes(binding, dependency),
  });
  const app = createApplication({
    providers: [],
    services: [
      valueService(GateToken, gate),
      ...createDatabaseBindings({
        default: "main",
        repositories: [notes],
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
      }),
    ],
  });
  await app.start();
  try {
    await app.run(async (scope) => {
      const db = scope.resolve(DATABASE_SESSION_TOKEN);
      await db.execute({
        text: "CREATE TABLE snapshot_notes (id INTEGER PRIMARY KEY, title TEXT)",
        params: [],
      });
      await db.execute({
        text: "CREATE TABLE snapshot_tags (id INTEGER PRIMARY KEY, alternate INTEGER)",
        params: [],
      });
      await db.execute({
        text: "INSERT INTO snapshot_notes VALUES (1,'keep'),(2,'keep'),(3,'drop')",
        params: [],
      });
      await db.execute({ text: "INSERT INTO snapshot_tags VALUES (1,3),(2,3),(3,3)", params: [] });
      const options: QueryOptions<Row> & { page: number; perPage: number } = {
        page: 1,
        perPage: 1,
        where: { title: "keep" },
        whereNodes: [
          {
            kind: "and",
            group: [
              { kind: "and", where: { id: 1 } },
              { kind: "or", where: { id: 2 } },
            ],
          },
        ],
        orderBy: [{ column: "id", direction: "asc" }],
        select: [
          { kind: "column", table: "snapshot_notes", column: "id" },
          { kind: "column", table: "snapshot_notes", column: "title" },
        ],
        joins: [
          {
            type: "inner",
            table: "snapshot_tags",
            on: [
              {
                left: { table: "snapshot_notes", column: "id" },
                right: { table: "snapshot_tags", column: "id" },
              },
            ],
          },
        ],
      };
      const result = db.repository(notes).paginate(options);
      try {
        await bounded(gate.entered.promise, "pagination readback override entry");
        present(options.where).title = "drop";
        present(options.whereNodes).splice(0);
        options.page = 3;
        options.perPage = 9;
        if (Array.isArray(options.orderBy)) present(options.orderBy[0]).direction = "desc";
        present(options.select).splice(0, 2, {
          kind: "literalText",
          value: "mutated",
          as: "title",
        });
        present(present(present(options.joins)[0]).on[0]).right.column = "alternate";
      } finally {
        gate.release.resolve();
      }
      const page = await bounded(result);
      assert.deepEqual(page.data, [{ id: 1, title: "keep" }]);
      assert.equal(page.meta.total, 2);
      assert.equal(page.meta.per_page, 1);
      assert.equal(page.meta.page, 1);
    });
  } finally {
    gate.release.resolve();
    await app.stop();
  }
});

function present<T>(value: T | undefined | null): T {
  assert.ok(value !== undefined && value !== null);
  return value;
}

import { defineModel } from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import { createNativePersistenceApplication } from "../helpers/nativePersistenceApplication";

test("malformed repository and model query snapshots are owned rejections without executing accessors", async () => {
  class Note extends Model<Row, "id"> {}
  const notes = defineRepository({
    name: "InvalidSnapshotNotes",
    table: defineTable<Row, "id">({
      name: "invalid_snapshot_notes",
      primaryKey: "id",
      columns: ["id", "title"],
    }),
    dependencies: [],
    create: (binding) => new BaseRepository(binding),
  });
  const note = defineModel({
    name: "InvalidSnapshotNote",
    repository: notes,
    dependencies: [],
    attributes: { timestamps: false },
    construct: (state, binding) => new Note(state, binding),
  });
  let sql = 0;
  let getters = 0;
  const app = await createNativePersistenceApplication(
    {
      default: "main",
      repositories: [notes],
      models: [note],
      connections: { main: { driver: "sqlite", filename: ":memory:" } },
    },
    () => {
      sql++;
    },
  );
  try {
    for (const kind of ["repository", "model query"] as const) {
      let operation: Promise<unknown> | undefined;
      const malformed = Object.defineProperty({}, "title", {
        enumerable: true,
        get() {
          getters++;
          throw new Error("Getter must stay inert");
        },
      });
      const before = sql;
      let failure: unknown;
      await assert.rejects(
        app.run((db) => {
          assert.doesNotThrow(() => {
            operation =
              kind === "repository"
                ? db.repository(notes).findAll({ where: malformed })
                : db
                    .model(note)
                    .query()
                    .find(malformed as never);
          });
          assert.ok(operation instanceof Promise);
          // Adopt the original terminal promise so its owned rejection is the
          // execution result; no getter or SQL may run during preparation.
          return operation;
        }),
        (error: unknown) => {
          failure = error;
          return (
            error instanceof TypeError && error.message === "Query plans cannot contain accessors."
          );
        },
      );
      await assert.rejects(present(operation), (error: unknown) => error === failure);
      assert.equal(getters, 0);
      assert.equal(sql, before, `${kind} snapshot rejection cannot admit native SQL`);
      await app.run(async (db) => {
        assert.deepEqual(await db.execute({ text: "SELECT 41 AS value", params: [] }), [
          { value: 41 },
        ]);
      });
    }
  } finally {
    await app.close();
  }
});

test("unbranded definition-looking write data is detached ordinary data before asynchronous hooks", async () => {
  type Values = Row & { kind?: string; metadata?: { label: string } };
  let gate = { entered: deferred(), release: deferred() };
  let captured: Partial<Values> | undefined;
  const notes = defineRepository({
    name: "OrdinarySnapshotNotes",
    table: defineTable<Values, "id">({
      name: "ordinary_snapshot_notes",
      primaryKey: "id",
      columns: ["id", "title"],
    }),
    dependencies: [],
    create: (binding) => new BaseRepository(binding),
    hooks: {
      async transformWrite(_action, values) {
        captured = values;
        gate.entered.resolve();
        await gate.release.promise;
        return { title: values.metadata?.label };
      },
    },
  });
  const app = await createNativePersistenceApplication({
    default: "main",
    repositories: [notes],
    connections: { main: { driver: "sqlite", filename: ":memory:" } },
  });
  try {
    await app.run(async (db) => {
      await db.execute({
        text: "CREATE TABLE ordinary_snapshot_notes (id INTEGER PRIMARY KEY, title TEXT)",
        params: [],
      });
      for (const kind of ["model", "repository"]) {
        gate = { entered: deferred(), release: deferred() };
        const input = { kind, metadata: { label: "original" }, title: "source" };
        const saved = db.repository(notes).create(input);
        await bounded(gate.entered.promise);
        try {
          input.kind = "mutated";
          input.metadata.label = "mutated";
          assert.notEqual(captured, input);
          assert.notEqual(present(captured).metadata, input.metadata);
          assert.deepEqual(captured, { kind, metadata: { label: "original" }, title: "source" });
        } finally {
          gate.release.resolve();
        }
        assert.equal((await saved).title, "original");
      }
      assert.deepEqual(
        await db.execute({
          text: "SELECT title FROM ordinary_snapshot_notes ORDER BY id",
          params: [],
        }),
        [{ title: "original" }, { title: "original" }],
      );
    });
  } finally {
    gate.release.resolve();
    await app.close();
  }
});

test("genuine RepositoryQuery exposes detached options and owns malformed snapshots and expired waiter denial", async () => {
  const notes = defineRepository({
    name: "RepositorySnapshotNotes",
    table: defineTable<Row, "id">({
      name: "repository_snapshot_notes",
      primaryKey: "id",
      columns: ["id", "title"],
    }),
    dependencies: [],
    create: (binding) => new BaseRepository(binding),
  });
  let sql = 0;
  let getters = 0;
  let expired: ReturnType<BaseRepository<Row, "id">["query"]> | undefined;
  const app = await createNativePersistenceApplication(
    {
      default: "main",
      repositories: [notes],
      connections: {
        main: { driver: "sqlite", filename: ":memory:" },
        other: { driver: "sqlite", filename: ":memory:" },
      },
    },
    () => {
      sql++;
    },
  );
  try {
    await app.run(async (db) => {
      await db.execute({
        text: "CREATE TABLE repository_snapshot_notes (id INTEGER PRIMARY KEY, title TEXT)",
        params: [],
      });
      await db.execute({
        text: "INSERT INTO repository_snapshot_notes VALUES (1,'original'),(2,'other')",
        params: [],
      });
      const query = db.repository(notes).query().whereIn("id", [1]).orderBy({ id: "asc" });
      const first = query.getOptions();
      const second = query.getOptions();
      assert.deepEqual(first, second);
      assert.notEqual(first, second);
      assert.notEqual(first.whereNodes, second.whereNodes);
      assert.notEqual(first.orderBy, second.orderBy);
      assert.ok(first.whereNodes);
      first.whereNodes.splice(0);
      if (first.orderBy && !Array.isArray(first.orderBy)) Reflect.set(first.orderBy, "id", "desc");
      assert.deepEqual(query.getOptions(), second);
      assert.deepEqual(await query.get(), [{ id: 1, title: "original" }]);
      const relation = {
        type: "hasMany" as const,
        name: "notes",
        localKey: "id" as const,
        foreignKey: "id" as const,
      };
      const beforeEager = sql;
      assert.throws(
        () =>
          db
            .repository(notes)
            .query()
            .withHasMany("children", relation, db.connection("other").repository(notes)),
        /Eager repositories must belong to the exact same live session/,
      );
      assert.equal(
        sql,
        beforeEager,
        "Foreign eager query selection denies before either real SQLite adapter executes",
      );
      assert.deepEqual(
        await db
          .repository(notes)
          .query()
          .where({ id: 1 })
          .withHasMany("children", relation, db.repository(notes))
          .get(),
        [{ id: 1, title: "original", children: [{ id: 1, title: "original" }] }],
      );
      expired = query;
    });
    const malformed = Object.defineProperty({}, "id", {
      enumerable: true,
      get() {
        getters++;
        throw new Error("Snapshot getter must remain inert");
      },
    });
    let waiter: Promise<unknown> | undefined;
    let failure: unknown;
    const before = sql;
    await assert.rejects(
      app.run((db) => {
        // orWhere retains a caller-provided condition as public query metadata;
        // its terminal snapshot must reject it without reading an accessor.
        const query = db.repository(notes).query().orWhere(malformed);
        assert.doesNotThrow(() => {
          waiter = query.get();
        });
        assert.ok(waiter instanceof Promise);
        return waiter;
      }),
      (error: unknown) => {
        failure = error;
        return (
          error instanceof TypeError && error.message === "Query plans cannot contain accessors."
        );
      },
    );
    await assert.rejects(present(waiter), (error: unknown) => error === failure);
    assert.equal(sql, before);
    assert.equal(getters, 0);
    let stale: Promise<unknown> | undefined;
    assert.doesNotThrow(() => {
      stale = present(expired).get();
    });
    assert.ok(stale instanceof Promise);
    await assert.rejects(
      stale,
      (error: unknown) =>
        error instanceof Error && Reflect.get(error, "code") === "APPLICATION_SCOPE_EXPIRED",
    );
    assert.equal(sql, before);
    await app.run(async (db) => {
      assert.deepEqual(await db.repository(notes).query().orderBy({ id: "asc" }).get(), [
        { id: 1, title: "original" },
        { id: 2, title: "other" },
      ]);
    });
  } finally {
    await app.close();
  }
});
