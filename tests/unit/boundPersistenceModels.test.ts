import { test } from "bun:test";
import assert from "node:assert/strict";
import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import {
  defineModel,
  defineRepository,
  type ModelBinding,
  type ModelObserver,
  type ModelState,
} from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";
import { bounded, deferred, pending } from "../fixtures/applicationOwnershipSupport";

type Row = { id: number; title: string; stamp?: Date; payload?: Buffer };
class Note extends Model<Row, "id"> {
  #memo: string;
  constructor(
    state: ModelState<Row>,
    binding: ModelBinding<Row, "id", BaseRepository<Row, "id">>,
    source?: Note,
  ) {
    super(state, binding);
    this.#memo = source ? source.#memo : "native-private-memo";
  }
  memo(): string {
    return this.#memo;
  }
}
const table = defineTable<Row, "id">({
  name: "bound_notes",
  primaryKey: "id",
  columns: ["id", "title", "stamp", "payload"],
});
const notes = defineRepository<Row, "id", BaseRepository<Row, "id">, readonly []>({
  name: "BoundNotes",
  table,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
function model(
  observers: readonly ReturnType<typeof createServiceToken<ModelObserver<Note>>>[] = [],
) {
  return defineModel<Row, "id", Note, BaseRepository<Row, "id">, readonly []>({
    name: "BoundNote",
    repository: notes,
    dependencies: [],
    attributes: { fillable: ["title"], timestamps: false },
    observers,
    construct: (state, binding, source) => new Note(state, binding, source),
  });
}
function declarations(note: ReturnType<typeof model>, extra: ReturnType<typeof model>[] = []) {
  return createDatabaseBindings({
    default: "main",
    repositories: [notes],
    models: [note, ...extra],
    connections: {
      main: { driver: "sqlite", filename: ":memory:" },
      other: { driver: "sqlite", filename: ":memory:" },
    },
  });
}

test("BP2 private-state binding copies expired source snapshots and clears loaded relations", async () => {
  const note = model();
  const sameClassOtherDefinition = defineModel<
    Row,
    "id",
    Note,
    BaseRepository<Row, "id">,
    readonly []
  >({
    name: "OtherBoundNote",
    repository: notes,
    dependencies: [],
    attributes: {},
    construct: (state, binding, source) => new Note(state, binding, source),
  });
  const sharedBindings = declarations(note, [sameClassOtherDefinition]);
  const app = createApplication({ providers: [], services: sharedBindings });
  const foreign = createApplication({ providers: [], services: sharedBindings });
  await Promise.all([app.start(), foreign.start()]);
  let source!: Note;
  try {
    await app.run({ kind: "command", tenant: { id: 1, slug: "one" } }, (scope) => {
      source = scope
        .resolve(DATABASE_SESSION_TOKEN)
        .model(note)
        .hydrate({
          id: 1,
          title: "original",
          stamp: new Date("2020-01-01T00:00:00Z"),
          payload: Buffer.from([1, 2]),
        });
      source.setLoaded("untrustedOldRelation", { owner: "source branch" });
      source.makeHidden("payload");
    });
    await app.run({ kind: "command", tenant: { id: 1, slug: "one" } }, (scope) => {
      const db = scope.resolve(DATABASE_SESSION_TOKEN);
      const copy = db.model(note).bind(source);
      assert.notEqual(copy, source);
      assert.equal(copy.memo(), "native-private-memo");
      assert.equal(copy.loaded("untrustedOldRelation"), undefined);
      assert.equal("payload" in copy.toArray(), false);
      assert.notEqual(copy.get("stamp"), source.get("stamp"));
      assert.notEqual(copy.get("payload"), source.get("payload"));
      present(copy.get("stamp")).setUTCFullYear(2030);
      present(copy.get("payload"))[0] = 9;
      copy.set("title", "target edit");
      assert.equal(present(source.get("stamp")).getUTCFullYear(), 2020);
      assert.equal(present(source.get("payload"))[0], 1);
      assert.equal(source.get("title"), "original");
      assert.throws(() => db.connection("other").model(note).bind(source));
      assert.throws(
        () => db.model(sameClassOtherDefinition).bind(source),
        "Identical subclass/row cannot substitute another model definition",
      );
    });
    await foreign.run({ kind: "command", tenant: { id: 1, slug: "one" } }, (scope) => {
      assert.throws(() => scope.resolve(DATABASE_SESSION_TOKEN).model(note).bind(source));
    });
    await app.run({ kind: "command", tenant: { id: 2, slug: "two" } }, (scope) => {
      assert.throws(() => scope.resolve(DATABASE_SESSION_TOKEN).model(note).bind(source));
    });
    await app.run(
      { kind: "command", tenant: { id: 1, slug: "one", metadata: { entitlement: "changed" } } },
      (scope) => {
        assert.throws(
          () => scope.resolve(DATABASE_SESSION_TOKEN).model(note).bind(source),
          "The same numeric tenant identity cannot replace the captured tenant envelope",
        );
      },
    );
    assert.throws(() => source.set("title", "expired edit"));
    await assert.rejects(async () => source.update({ title: "stale terminal edit" }));
    assert.equal(source.get("title"), "original", "Stale terminal rejects before local edits");
  } finally {
    await Promise.all([app.stop(), foreign.stop()]);
  }
});

test("BP3 entity latch admits owned observer edits and rejects recursive, sibling and bind mutations", async () => {
  const Observer = createServiceToken<ModelObserver<Note>>("bound.note.observer");
  const note = model([Observer]);
  const entered = deferred();
  const release = deferred();
  const app = createApplication({
    providers: [],
    services: [
      valueService(Observer, {
        async saving(entity) {
          entity.set("title", "owned observer edit");
          assert.throws(() => entity.save(), "Recursive terminal mutation must not enter SQL");
          entered.resolve();
          await release.promise;
        },
      }),
      ...declarations(note),
    ],
  });
  await app.start();
  try {
    await app.run(async (scope) => {
      const db = scope.resolve(DATABASE_SESSION_TOKEN);
      await db.execute({
        text: "CREATE TABLE bound_notes (id INTEGER PRIMARY KEY, title TEXT, stamp TEXT, payload BLOB)",
        params: [],
      });
      await db.execute({
        text: "INSERT INTO bound_notes (id, title) VALUES (1, 'before')",
        params: [],
      });
      const entity = await db.model(note).findOrFail(1);
      const saving = entity.save();
      try {
        await bounded(entered.promise);
        await pending(saving);
        assert.throws(() => entity.set("title", "outsider edit"));
        assert.throws(() => entity.fill({ title: "outsider fill" }));
        assert.throws(() => entity.save());
        assert.throws(
          () => db.model(note).bind(entity),
          "Inspect the source binding's active mutation latch",
        );
        await db.transaction((tx) => {
          assert.throws(
            () => tx.model(note).bind(entity),
            "A different target registry must inspect the source latch",
          );
        });
      } finally {
        release.resolve();
      }
      await bounded(saving);
      entity.set("title", "editable after joined settlement");
      const rows = await db.execute<{ title: string }>({
        text: "SELECT title FROM bound_notes WHERE id = 1",
        params: [],
      });
      assert.deepEqual(rows, [{ title: "owned observer edit" }]);
      assert.equal(entity.get("title"), "editable after joined settlement");
    });
  } finally {
    release.resolve();
    await app.stop();
  }
});

test("BP5 confirmed outer rollback restores released child creates without calling user methods", async () => {
  const Observer = createServiceToken<ModelObserver<Note>>("bound.rollback.observer");
  let hooks = 0;
  const note = model([Observer]);
  const app = createApplication({
    providers: [],
    services: [
      valueService(Observer, {
        creating() {
          hooks++;
        },
        created() {
          hooks++;
        },
      }),
      ...declarations(note),
    ],
  });
  await app.start();
  const created: Note[] = [];
  try {
    await app.run(async (scope) => {
      const db = scope.resolve(DATABASE_SESSION_TOKEN);
      await db.execute({
        text: "CREATE TABLE bound_notes (id INTEGER PRIMARY KEY, title TEXT, stamp TEXT, payload BLOB)",
        params: [],
      });
      await db.transaction(async (outer) => {
        await outer.transaction(async (child) => {
          for (const title of ["first", "second"]) {
            const entity = await child.model(note).create({ title });
            assert.equal(entity.$exists, true);
            assert.equal(typeof entity.id, "number");
            entity.set("title", `${title} later intentional edit`);
            created.push(entity);
          }
        });
        assert.equal(
          created.every((entity) => entity.$exists),
          true,
          "Confirmed RELEASE has not rolled anything back",
        );
        assert.equal(hooks, 4);
        outer.requestRollback();
      });
      assert.equal(hooks, 4, "Framework rollback does not replay user observers");
      assert.deepEqual(
        created.map((entity) => ({
          exists: entity.$exists,
          id: entity.id,
          title: entity.get("title"),
        })),
        [
          { exists: false, id: undefined, title: "first later intentional edit" },
          { exists: false, id: undefined, title: "second later intentional edit" },
        ],
      );
      assert.deepEqual(await db.execute({ text: "SELECT id FROM bound_notes", params: [] }), []);
    });
  } finally {
    await app.stop();
  }
});

// Deliberately exercise source-private controller history, never a public restore API.
import { getBindingPorts } from "#strata-orm-internal";
import { getModelBinding } from "#strata-orm-runtime";

test("BP5 rollback attempts every LIFO restore after a strict falsy failure and preserves native rollback", async () => {
  const note = model();
  const app = createApplication({ providers: [], services: declarations(note) });
  const calls: string[] = [];
  let entity!: Note;
  await app.start();
  try {
    const outcome = await app
      .run(async (scope) => {
        const db = scope.resolve(DATABASE_SESSION_TOKEN);
        await db.execute({
          text: "CREATE TABLE bound_notes (id INTEGER PRIMARY KEY, title TEXT, stamp TEXT, payload BLOB)",
          params: [],
        });
        await assert.rejects(async () =>
          db.transaction(async (tx) => {
            const port = getBindingPorts(
              getModelBinding(tx.model(note).newRecord({ title: "port owner" })),
            );
            port.registerRestore(() => {
              calls.push("first");
              return undefined;
            });
            entity = await tx.model(note).create({ title: "retry intent" });
            entity.set("title", "later edit");
            Object.defineProperty(entity, "set", {
              value() {
                throw new Error("Rollback must never call virtual set");
              },
            });
            port.registerRestore(() => {
              calls.push("falsy");
              throw false;
            });
            port.registerRestore(() => {
              calls.push("last");
              return undefined;
            });
            tx.requestRollback();
          }),
        );
        assert.deepEqual(calls, ["last", "falsy", "first"]);
        assert.equal(entity.$exists, false);
        assert.equal(entity.id, undefined);
        assert.equal(entity.get("title"), "later edit");
        assert.deepEqual(await db.execute({ text: "SELECT id FROM bound_notes", params: [] }), []);
      })
      .then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error }),
      );
    assert.equal(
      outcome.ok,
      false,
      "Inspected transaction error cannot recover a strict restore occurrence",
    );
    if (!outcome.ok)
      assert.equal(
        outcome.error,
        false,
        "The opaque falsy restore failure occurs once, without reinsertion",
      );
    assert.equal(
      (await app.stop()).successful,
      true,
      "Confirmed rollback permits safe pin and application disposal",
    );
  } finally {
    await app.stop();
  }
});

function present<T>(value: T | undefined | null): T {
  assert.ok(value !== undefined && value !== null);
  return value;
}

test("model factories cannot substitute another selected model binding or a plain object", async () => {
  const proper = model();
  let misplaced: Note | undefined;
  let constructors = 0;
  const bad = ["wrong-binding", "plain-object"].map((kind) =>
    defineModel<Row, "id", Note, BaseRepository<Row, "id">, readonly []>({
      name: `FactoryFailure-${kind}`,
      repository: notes,
      dependencies: [],
      attributes: { timestamps: false },
      construct() {
        constructors++;
        return kind === "wrong-binding" ? present(misplaced) : ({} as Note);
      },
    }),
  );
  const app = createApplication({ providers: [], services: declarations(proper, bad) });
  await app.start();
  try {
    await app.run((scope) => {
      const selected = scope.resolve(DATABASE_SESSION_TOKEN);
      misplaced = selected.connection("other").model(proper).newRecord({ title: "foreign owner" });
      for (const definition of bad)
        assert.throws(
          () => selected.model(definition).newRecord({ title: "must not bind" }),
          /wrong binding/,
        );
      assert.equal(constructors, 2);
      const valid = selected.model(proper).newRecord({ title: "original binding" });
      assert.equal(valid.memo(), "native-private-memo");
      assert.equal(valid.get("title"), "original binding");
      assert.equal(present(misplaced).get("title"), "foreign owner");
    });
  } finally {
    assert.equal((await app.stop()).successful, true);
  }
});

test("public root and transaction bindings always return rejected Promises after admission expires", async () => {
  type Binding = import("@getstrata/core/database/definitions").RepositoryBinding<Row, "id">;
  const bindings: Binding[] = [];
  const definition = defineRepository({
    name: "PromiseAdmission",
    table: defineTable<Row, "id">({
      name: "promise_admission",
      primaryKey: "id",
      columns: ["id", "title"],
    }),
    dependencies: [],
    create: (binding) => {
      bindings.push(binding);
      return new BaseRepository(binding);
    },
  });
  const app = createApplication({
    providers: [],
    services: createDatabaseBindings({
      default: "main",
      connections: { main: { driver: "sqlite", filename: ":memory:" } },
      repositories: [definition],
    }),
  });
  let root: Binding | undefined;
  let transaction: Binding | undefined;
  let work = 0;
  const returned = <T>(invoke: () => Promise<T>): Promise<T> => {
    let promise: Promise<T> | undefined;
    assert.doesNotThrow(() => {
      promise = invoke();
    }, "RepositoryBinding.run promises failure rather than throwing synchronously");
    assert.ok(promise instanceof Promise);
    return promise;
  };
  await app.start();
  try {
    await app.run(async (scope) => {
      const database = scope.resolve(DATABASE_SESSION_TOKEN);
      await database.execute({
        text: "CREATE TABLE promise_admission(id INTEGER PRIMARY KEY,title TEXT)",
        params: [],
      });
      database.repository(definition);
      root = present(bindings.at(-1));
      const active = returned(() =>
        present(root).run(() => {
          work++;
          return "root body";
        }),
      );
      assert.equal(work, 0, "Valid operation bodies are not invoked inline");
      assert.equal(await active, "root body");
      await database.transaction(async (child) => {
        child.repository(definition);
        transaction = present(bindings.at(-1));
        const activeChild = returned(() =>
          present(transaction).run(() => {
            work++;
            return "child body";
          }),
        );
        assert.equal(work, 1);
        assert.equal(await activeChild, "child body");
      });
      const denied = returned(() =>
        present(transaction).run(async () => {
          work++;
          await present(transaction).session.execute({
            text: "INSERT INTO promise_admission VALUES (1,'late child')",
            params: [],
          });
        }),
      );
      await assert.rejects(denied, (error) => {
        assert.ok(error instanceof Error);
        assert.equal(Reflect.get(error, "code"), "DATABASE_TRANSACTION_SCOPE");
        assert.equal(Reflect.get(error, "data"), undefined);
        assert.equal(Reflect.get(error, "cause"), undefined);
        return true;
      });
      assert.equal(work, 2);
    });
    const denied = returned(() =>
      present(root).run(async () => {
        work++;
        await present(root).session.execute({
          text: "INSERT INTO promise_admission VALUES (2,'late root')",
          params: [],
        });
      }),
    );
    await assert.rejects(denied, (error) => {
      assert.ok(error instanceof Error);
      assert.equal(Reflect.get(error, "code"), "APPLICATION_SCOPE_EXPIRED");
      assert.equal(Reflect.get(error, "cause"), undefined);
      return true;
    });
    assert.equal(work, 2);
    await app.run(async (scope) =>
      assert.deepEqual(
        await scope
          .resolve(DATABASE_SESSION_TOKEN)
          .execute({ text: "SELECT id FROM promise_admission", params: [] }),
        [],
      ),
    );
  } finally {
    assert.equal((await app.stop()).successful, true);
  }
});

test("model mutation failure and a real deadline release the latch for same-entity retry and fresh binding", async () => {
  const Observer = createServiceToken<ModelObserver<Note>>("mutation admission recovery");
  const definition = model([Observer]);
  const observerFailure = new Error("ordinary asynchronous observer failure");
  let mode: "fail" | "deadline" | "pass" = "fail";
  let signal: AbortSignal | undefined;
  let deadlineReason: unknown;
  const deadlineEntered = deferred();
  const app = createApplication({
    providers: [],
    services: [
      valueService(Observer, {
        async saving() {
          if (mode === "fail") {
            await Promise.resolve();
            throw observerFailure;
          }
          if (mode === "deadline") {
            const active = present(signal);
            deadlineEntered.resolve();
            await new Promise<void>((resolve) => {
              const ended = () => {
                deadlineReason = active.reason;
                resolve();
              };
              if (active.aborted) ended();
              else active.addEventListener("abort", ended, { once: true });
            });
          }
        },
      }),
      ...declarations(definition),
    ],
  });
  await app.start();
  let source: Note | undefined;
  try {
    await app.run(async (scope) => {
      const database = scope.resolve(DATABASE_SESSION_TOKEN);
      await database.execute({
        text: "CREATE TABLE bound_notes(id INTEGER PRIMARY KEY,title TEXT,stamp TEXT,payload BLOB)",
        params: [],
      });
      const selected = database.model(definition);
      const entity = selected.newRecord({ title: "retry intent" });
      await assert.rejects(entity.save(), (error) => error === observerFailure);
      entity.set("title", "retry accepted");
      assert.equal(selected.bind(entity).get("title"), "retry accepted");
      mode = "pass";
      await entity.save();
      assert.equal(entity.$exists, true);
    });
    mode = "deadline";
    const expired = app
      .run({ kind: "command", deadlineAtMs: Date.now() + 500 }, async (scope) => {
        signal = scope.signal;
        source = scope
          .resolve(DATABASE_SESSION_TOKEN)
          .model(definition)
          .newRecord({ title: "deadline intent" });
        const saving = source.save();
        await bounded(deadlineEntered.promise, "real deadline mutation observer admission");
        await assert.rejects(saving, (error) => error === deadlineReason);
      })
      .then(
        () => ({ ok: true as const }),
        (error) => ({ ok: false as const, error }),
      );
    const outcome = await bounded(expired, "real deadline mutation settles", 3000);
    // The operation's original deadline failure was explicitly observed above;
    // handling it does not invent an additional root-execution failure.
    assert.equal(outcome.ok, true);
    assert.ok(deadlineReason instanceof Error);
    assert.equal(Reflect.get(deadlineReason, "code"), "EXECUTION_DEADLINE");
    mode = "pass";
    await app.run(async (scope) => {
      const database = scope.resolve(DATABASE_SESSION_TOKEN);
      assert.deepEqual(
        await database.execute({ text: "SELECT title FROM bound_notes ORDER BY id", params: [] }),
        [{ title: "retry accepted" }],
      );
      const recovered = database.model(definition).bind(present(source));
      assert.equal(recovered.$exists, false);
      assert.equal(recovered.get("title"), "deadline intent");
      await recovered.save();
      assert.deepEqual(
        await database.execute({ text: "SELECT title FROM bound_notes ORDER BY id", params: [] }),
        [{ title: "retry accepted" }, { title: "deadline intent" }],
      );
    });
  } finally {
    assert.equal((await app.stop()).successful, true);
  }
});
