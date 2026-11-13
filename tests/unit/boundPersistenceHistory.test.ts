import { test } from "bun:test";
import assert from "node:assert/strict";
import { resourceService } from "@getstrata/core/contracts/services";
import type { ServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { defineModel, defineRepository } from "@getstrata/core/database/definitions";
import type {
  Decision,
  RawPin,
  RawPool,
  RawTransaction,
  SavepointTerminal,
  SqlStatement,
  Terminal,
} from "@getstrata/core/database/driverPorts";
import { Model } from "@getstrata/core/database/model";
import { dialectFor } from "@getstrata/core/database/sqlDialects";
import { defineTable } from "@getstrata/core/database/table";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";
import { getBindingPorts } from "#strata-orm-internal";
import { getModelBinding } from "#strata-orm-runtime";
import { bounded, deferred, pending } from "../fixtures/applicationOwnershipSupport";

type Row = { id: number; title: string };
class Note extends Model<Row, "id"> {
  #identity = "native-history-model";
  identity(): string {
    return this.#identity;
  }
}
const notes = defineRepository<Row, "id", BaseRepository<Row, "id">, readonly []>({
  name: "HistoryNotes",
  table: defineTable<Row, "id">({
    name: "history_notes",
    primaryKey: "id",
    columns: ["id", "title"],
  }),
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const note = defineModel<Row, "id", Note, BaseRepository<Row, "id">, readonly []>({
  name: "HistoryNote",
  repository: notes,
  dependencies: [],
  attributes: { fillable: ["title"], timestamps: false },
  construct: (state, binding) => new Note(state, binding),
});

// Synthetic terminal evidence is explicit; canonical registry/session/controller ownership is real.
function fixture(
  mode: "rollback" | "released-unhealthy" | "unknown-child" | "commit" | "unknown-outer",
) {
  const events: string[] = [];
  const ackEntered = deferred();
  const ackRelease = deferred();
  let depth = 0;
  let id = 0;
  const raw: RawTransaction = {
    async execute<R>(statement: SqlStatement) {
      if (statement.text.startsWith("INSERT"))
        return [{ id: ++id, title: statement.params[0] }] as R[];
      return [] as R[];
    },
    async savepoint<R>(
      work: (child: RawTransaction) => Promise<Decision<R>>,
    ): Promise<SavepointTerminal<R>> {
      const level = ++depth;
      const decision = await work(raw);
      depth--;
      const unknown = mode === "unknown-child" && level === 2;
      const released = mode === "released-unhealthy";
      return {
        data: unknown
          ? "unknown"
          : released
            ? "released"
            : decision.finish === "commit"
              ? "released"
              : "rolled-back",
        nativeState: unknown ? "unknown" : "transaction-active",
        stage: { kind: "decided", decision },
        phases: [
          {
            phase: unknown
              ? "release-savepoint"
              : decision.finish === "commit"
                ? "release-savepoint"
                : "rollback-to",
            acknowledgement: unknown ? "unknown" : "confirmed-reply",
            failure: null,
          },
        ],
        failure: released
          ? { error: new Error("Confirmed RELEASE followed by JS observation failure") }
          : null,
      };
    },
  };
  const pin: RawPin = {
    async begin<R>(work: (tx: RawTransaction) => Promise<Decision<R>>): Promise<Terminal<R>> {
      const decision = await work(raw);
      events.push(`decision:${decision.finish}`);
      ackEntered.resolve();
      await ackRelease.promise;
      events.push("native.terminal");
      return {
        data:
          mode === "unknown-outer"
            ? "unknown"
            : decision.finish === "commit"
              ? "committed"
              : "rolled-back",
        nativeState: mode === "unknown-outer" ? "unknown" : "idle",
        stage: { kind: "decided", decision },
        phases: [
          {
            phase: decision.finish,
            acknowledgement: mode === "unknown-outer" ? "unknown" : "confirmed-reply",
            failure: null,
          },
        ],
        failure: null,
      };
    },
    async release() {
      events.push("pin.release");
      return { ok: true };
    },
    async discard() {
      events.push("pin.discard");
      return { ok: true };
    },
  };
  const pool: RawPool = {
    dialect: dialectFor("sqlite"),
    capabilities: Object.freeze({
      driver: "sqlite",
      transactions: true,
      savepoints: true,
      rowLocks: false,
      postgresRls: false,
      cancellableCheckout: false,
      observableCheckout: false,
      isolatedDiscard: false,
    }),
    async execute<R>() {
      return [] as R[];
    },
    async checkout() {
      return { ok: true, value: pin };
    },
    close() {
      events.push("pool.close");
    },
  };
  const bindings = createDatabaseBindings({
    default: "test",
    repositories: [notes],
    models: [note],
    connections: { test: { driver: "sqlite", filename: ":memory:" } },
  });
  const resource = bindings.find((value) => value.kind === "resource");
  assert.ok(resource);
  const app = createApplication({
    providers: [],
    services: bindings,
    overrides: [
      resourceService(resource.token as ServiceToken<RawPool>, {
        lifetime: "application",
        dependencies: [],
        create: () => ({
          name: "synthetic ORM native protocol",
          open: () => ({ ok: true, value: pool }),
          close: (owned) => owned.close(),
        }),
      }),
    ],
  });
  return { app, events, ackEntered, ackRelease };
}

test("BP5 native outer ACK gates restores and released-unhealthy child history still promotes", async () => {
  const f = fixture("released-unhealthy");
  const restored: string[] = [];
  let entity!: Note;
  await f.app.start();
  const actual = f.app.run(async (scope) => {
    await scope.resolve(DATABASE_SESSION_TOKEN).transaction(async (outer) => {
      await assert.rejects(async () =>
        outer.transaction(async (child) => {
          entity = await child.model(note).create({ title: "retry" });
          getBindingPorts(getModelBinding(entity)).registerRestore(() => {
            restored.push("child");
            return undefined;
          });
        }),
      );
      assert.deepEqual(restored, []);
      assert.equal(entity.$exists, true);
      outer.requestRollback();
    });
  });
  const observed = actual.then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error }),
  );
  try {
    await bounded(f.ackEntered.promise);
    assert.deepEqual(restored, [], "Intent to roll back is not native ACK");
    assert.equal(entity.$exists, true);
    await pending(actual);
    f.ackRelease.resolve();
    await bounded(observed);
    assert.deepEqual(
      restored,
      ["child"],
      "Confirmed RELEASE promotes despite unhealthy JS observation",
    );
    assert.equal(entity.$exists, false);
    assert.ok(f.events.indexOf("native.terminal") < f.events.indexOf("pin.release"));
  } finally {
    f.ackRelease.resolve();
    await observed;
    await f.app.stop();
  }
});

test("BP5 unknown child history waits through confirmed middle rollback until original outer rollback", async () => {
  const f = fixture("unknown-child");
  const restored: string[] = [];
  await f.app.start();
  const actual = f.app.run(async (scope) => {
    await scope.resolve(DATABASE_SESSION_TOKEN).transaction(async (outer) => {
      await assert.rejects(async () =>
        outer.transaction(async (middle) => {
          const owner = middle.model(note).newRecord({ title: "middle" });
          getBindingPorts(getModelBinding(owner)).registerRestore(() => {
            restored.push("middle");
            return undefined;
          });
          await assert.rejects(async () =>
            middle.transaction((inner) => {
              const entity = inner.model(note).newRecord({ title: "unknown" });
              getBindingPorts(getModelBinding(entity)).registerRestore(() => {
                restored.push("unknown");
                return undefined;
              });
            }),
          );
        }),
      );
      assert.deepEqual(
        restored,
        ["middle"],
        "Known middle rollback cannot manufacture unknown child restoration",
      );
      outer.requestRollback();
    });
  });
  const observed = actual.then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error }),
  );
  try {
    await bounded(f.ackEntered.promise);
    assert.deepEqual(restored, ["middle"]);
    f.ackRelease.resolve();
    await bounded(observed);
    assert.deepEqual(restored, ["middle", "unknown"]);
    assert.ok(f.events.includes("decision:rollback"));
    assert.ok(f.events.includes("pin.release"));
  } finally {
    f.ackRelease.resolve();
    await observed;
    await f.app.stop();
  }
});

test("BP5 committed or unknown outer outcomes never restore from commit or physical discard", async () => {
  for (const mode of ["commit", "unknown-outer"] as const) {
    const f = fixture(mode);
    let restores = 0;
    await f.app.start();
    const actual = f.app.run(async (scope) => {
      await scope.resolve(DATABASE_SESSION_TOKEN).transaction((tx) => {
        const entity = tx.model(note).newRecord({ title: mode });
        getBindingPorts(getModelBinding(entity)).registerRestore(() => {
          restores++;
          return undefined;
        });
      });
    });
    const observed = actual.then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );
    try {
      await bounded(f.ackEntered.promise);
      assert.equal(restores, 0);
      f.ackRelease.resolve();
      const result = await bounded(observed);
      assert.equal(result.ok, mode === "commit");
      assert.equal(restores, 0);
      assert.ok(f.events.includes(mode === "commit" ? "pin.release" : "pin.discard"));
    } finally {
      f.ackRelease.resolve();
      await observed;
      await f.app.stop();
    }
  }
});
