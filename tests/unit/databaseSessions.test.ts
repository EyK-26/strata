import { test } from "bun:test";
import assert from "node:assert/strict";
import { CORE_EXECUTION_CONTEXT_TOKEN } from "@getstrata/core/contracts/executionContext";
import { CORE_EXECUTION_OPERATIONS_TOKEN } from "@getstrata/core/contracts/executionOperations";
import type { OwnedExecution } from "@getstrata/core/contracts/executionOwnership";
import { CORE_EXECUTION_OWNERSHIP_TOKEN } from "@getstrata/core/contracts/executionOwnership";
import { resourceService } from "@getstrata/core/contracts/services";
import type { ServiceToken } from "@getstrata/core/contracts/token";
import { createTransactionAcquisitionMetrics } from "@getstrata/core/database/acquisitionMetrics";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import type {
  Decision,
  DisposeAck,
  RawPin,
  RawPool,
  RawTransaction,
  SqlStatement,
  Terminal,
} from "@getstrata/core/database/driverPorts";
import { PersistenceError } from "@getstrata/core/database/errors";
import type { DatabaseSession, TransactionSession } from "@getstrata/core/database/session";
import { dialectFor } from "@getstrata/core/database/sqlDialects";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { TransactionRuntime } from "@getstrata/core/database/transactionSession";
import { createApplication } from "@getstrata/core/runtime/application";
import { bounded, deferred, pending, rejected } from "../fixtures/applicationOwnershipSupport";

const sql = (text: string, params: readonly unknown[] = []) => ({ text, params });
const sqlite = () =>
  createDatabaseBindings({
    default: "main",
    connections: {
      main: { driver: "sqlite", filename: ":memory:" },
      other: { driver: "sqlite", filename: ":memory:" },
    },
  });
const attempt = async <T>(work: () => T) => {
  try {
    return { ok: true as const, value: await work() };
  } catch (error) {
    return { ok: false as const, error };
  }
};

// These cases use real in-memory SQLite; synthetic protocol faults are labeled below.
test("database named bindings copy explicit config and isolate pools between applications", async () => {
  const config = {
    default: "main",
    connections: {
      main: { driver: "sqlite" as const, filename: ":memory:" },
      other: { driver: "sqlite" as const, filename: ":memory:" },
    },
  };
  const bindings = createDatabaseBindings(config);
  assert.equal(Object.isFrozen(bindings), true);
  const pools = bindings.filter((item) => item.kind === "resource");
  assert.equal(pools.length, 2, "each configured pool is independently journal-owned");
  assert.ok(pools.every((item) => item.lifetime === "application"));
  assert.notEqual(pools[0]?.token, pools[1]?.token);
  config.default = "missing";
  config.connections.main.filename = "/must-not-open-this-mutated-path/database.sqlite";
  const first = createApplication({ providers: [], services: bindings });
  const second = createApplication({ providers: [], services: sqlite() });
  await first.start();
  await second.start();
  try {
    const one = await first.run(async (scope) => {
      const db = scope.resolve(DATABASE_SESSION_TOKEN);
      const other = db.connection("other");
      await db.execute(sql("CREATE TABLE isolated (value INTEGER)"));
      await db.execute(sql("INSERT INTO isolated VALUES (?)", [7]));
      await other.execute(sql("CREATE TABLE isolated (value INTEGER)"));
      await other.execute(sql("INSERT INTO isolated VALUES (?)", [9]));
      return {
        rows: await db.execute(sql("SELECT value FROM isolated")),
        other: await other.execute(sql("SELECT value FROM isolated")),
        dialect: db.dialect,
        capabilities: db.capabilities,
        invalid: await attempt(() => db.connection("absent")),
      };
    });
    const two = await second.run(async (scope) => {
      const db = scope.resolve(DATABASE_SESSION_TOKEN);
      await db.execute(sql("CREATE TABLE isolated (value INTEGER)"));
      return db.execute(sql("SELECT value FROM isolated"));
    });
    assert.deepEqual(one.rows, [{ value: 7 }]);
    assert.deepEqual(one.other, [{ value: 9 }]);
    assert.deepEqual(two, []);
    assert.equal(one.invalid.ok, false);
    assert.equal(one.capabilities.driver, "sqlite");
    assert.equal(Object.isFrozen(one.dialect), true);
    assert.equal(Object.isFrozen(one.capabilities), true);
  } finally {
    await first.stop();
    await second.stop();
  }
});

test("database config rejects unsupported drivers fields names and inherited defaults before effects", () => {
  const invalid: unknown[] = [
    { default: "", connections: { main: { driver: "sqlite", filename: ":memory:" } } },
    { default: "missing", connections: { main: { driver: "sqlite", filename: ":memory:" } } },
    { default: "main", connections: { main: { driver: "other", filename: ":memory:" } } },
    { default: "main", connections: { main: { driver: "sqlite", filename: ":memory:", max: 1 } } },
    { default: "main", connections: { main: { driver: "pgsql", url: "", max: 1 } } },
    {
      default: "main",
      connections: { main: { driver: "mysql", url: "mysql://secret@example.invalid/db", max: 0 } },
    },
    Object.assign(Object.create({ default: "main" }), {
      connections: { main: { driver: "sqlite", filename: ":memory:" } },
    }),
  ];
  for (const config of invalid)
    assert.throws(() =>
      createDatabaseBindings(config as Parameters<typeof createDatabaseBindings>[0]),
    );
});

test("SQLite explicit rollback preserves undefined and falsy results and SQL failure is rollback-only", async () => {
  const app = createApplication({ providers: [], services: sqlite() });
  await app.start();
  try {
    const result = await app.run(async (scope) => {
      const db = scope.resolve(DATABASE_SESSION_TOKEN);
      await db.execute(sql("CREATE TABLE items (id INTEGER PRIMARY KEY)"));
      let observers = 0;
      const values = [];
      for (const value of [undefined, false, 0, "", null])
        values.push(
          await db.transaction(async (tx) => {
            await tx.execute(sql("INSERT INTO items VALUES (1)"));
            tx.afterCommit(() => {
              observers++;
            });
            tx.requestRollback();
            return value;
          }),
        );
      const marker = Symbol("ordinary body");
      const ordinary = await attempt(() =>
        db.transaction(() => {
          throw marker;
        }),
      );
      const poisoned = await attempt(() =>
        db.transaction(async (tx) => {
          await tx.execute(sql("INSERT INTO items VALUES (2)"));
          await tx.execute(sql("INSERT INTO items VALUES (2)")).catch(() => {});
          return "caught SQL error";
        }),
      );
      return {
        values,
        observers,
        ordinary,
        marker,
        poisoned,
        rows: await db.execute(sql("SELECT id FROM items")),
      };
    });
    assert.deepEqual(result.values, [undefined, false, 0, "", null]);
    assert.equal(result.observers, 0);
    assert.equal(result.ordinary.ok, false);
    if (!result.ordinary.ok) assert.equal(result.ordinary.error, result.marker);
    assert.equal(result.poisoned.ok, false, "caught invoked SQL failure cannot authorize COMMIT");
    if (!result.poisoned.ok) {
      assert.ok(result.poisoned.error instanceof PersistenceError);
      assert.equal(result.poisoned.error.code, "DATABASE_TRANSACTION_ROLLBACK_ONLY");
      assert.equal(result.poisoned.error.data, "rolled-back");
    }
    assert.deepEqual(result.rows, []);
  } finally {
    await app.stop();
  }
});

test("SQLite savepoint rollback recovers parent and exact branch guards all parent methods", async () => {
  const app = createApplication({ providers: [], services: sqlite() });
  await app.start();
  let stale!: TransactionSession;
  let saved!: DatabaseSession;
  try {
    const observed = await attempt(() =>
      app.run(async (scope) => {
        const db = scope.resolve(DATABASE_SESSION_TOKEN);
        saved = db;
        await db.execute(sql("CREATE TABLE items (id INTEGER PRIMARY KEY)"));
        const guards: boolean[] = [];
        const callbacks: number[] = [];
        await db.transaction(async (parent) => {
          await parent.execute(sql("INSERT INTO items VALUES (1)"));
          const childFailure = await attempt(() =>
            parent.transaction(async (child) => {
              stale = child;
              guards.push(
                (await attempt(() => parent.execute(sql("INSERT INTO items VALUES (90)")))).ok,
              );
              guards.push((await attempt(() => parent.transaction(() => 0))).ok);
              guards.push((await attempt(() => parent.afterCommit(() => {}))).ok);
              guards.push((await attempt(() => parent.requestRollback())).ok);
              guards.push(
                (await attempt(() => db.execute(sql("INSERT INTO items VALUES (91)")))).ok,
              );
              await child.execute(sql("INSERT INTO items VALUES (2)"));
              child.afterCommit(() => {
                callbacks.push(2);
              });
              await child.execute(sql("INSERT INTO items VALUES (2)"));
            }),
          );
          guards.push(childFailure.ok);
          guards.push(
            (await attempt(() => stale.execute(sql("INSERT INTO items VALUES (92)")))).ok,
          );
          await parent.execute(sql("INSERT INTO items VALUES (3)"));
          parent.afterCommit(() => {
            callbacks.push(1);
          });
        });
        return {
          guards,
          callbacks,
          rows: await db.execute(sql("SELECT id FROM items ORDER BY id")),
        };
      }),
    );
    assert.ok(observed.ok, "a recovered savepoint must leave its healthy parent usable");
    const result = observed.value;
    assert.deepEqual(result.guards, [false, false, false, false, false, false, false]);
    assert.deepEqual(result.rows, [{ id: 1 }, { id: 3 }]);
    assert.deepEqual(result.callbacks, [1]);
    const wrongRun = await app.run(() => attempt(() => saved.execute(sql("SELECT 1"))));
    assert.equal(wrongRun.ok, false);
    assert.equal((await attempt(() => stale.requestRollback())).ok, false);
  } finally {
    await app.stop();
  }
});

test("SQLite joins actual transaction descendants before COMMIT and observer descendants before next observer", async () => {
  const app = createApplication({ providers: [], services: sqlite() });
  const entered = deferred();
  const proceed = deferred();
  const observerEntered = deferred();
  const observerProceed = deferred();
  const events: string[] = [];
  let transaction!: Promise<unknown>;
  await app.start();
  const run = app.run(async (scope) => {
    const db = scope.resolve(DATABASE_SESSION_TOKEN);
    const operations = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
    await db.execute(sql("CREATE TABLE items (id INTEGER PRIMARY KEY)"));
    transaction = db.transaction((tx) => {
      void operations.operation(async () => {
        entered.resolve();
        await proceed.promise;
        await tx.execute(sql("INSERT INTO items VALUES (1)"));
        events.push("business SQL");
      });
      tx.afterCommit(() => {
        events.push("observer 1");
        void operations.operation(async () => {
          observerEntered.resolve();
          await observerProceed.promise;
          await db.transaction(async (next) => {
            await next.execute(sql("INSERT INTO items VALUES (2)"));
          });
          events.push("observer child reentry");
        });
      });
      tx.afterCommit(() => {
        events.push("observer 2");
      });
      return 7;
    });
    const value = await transaction;
    return { value, rows: await db.execute(sql("SELECT id FROM items ORDER BY id")) };
  });
  try {
    await bounded(entered.promise);
    await pending(transaction);
    assert.deepEqual(events, []);
    proceed.resolve();
    await bounded(observerEntered.promise);
    await pending(transaction);
    assert.deepEqual(events, ["business SQL", "observer 1"]);
    observerProceed.resolve();
    const result = await bounded(run);
    assert.equal(result.value, 7);
    assert.deepEqual(result.rows, [{ id: 1 }, { id: 2 }]);
    assert.deepEqual(events, [
      "business SQL",
      "observer 1",
      "observer child reentry",
      "observer 2",
    ]);
  } finally {
    proceed.resolve();
    observerProceed.resolve();
    await Promise.allSettled([run, transaction]);
    await app.stop();
  }
});

/** Deterministic synthetic protocol adapter, never evidence about native driver guarantees. */
function syntheticPool(overrides: Partial<RawPool> = {}, pinOverrides: Partial<RawPin> = {}) {
  const events: string[] = [];
  const raw: RawTransaction = {
    async execute<Row>(statement: SqlStatement) {
      events.push(`tx.sql:${statement.text}`);
      return [] as Row[];
    },
    async savepoint<R>(work: (child: RawTransaction) => Promise<Decision<R>>) {
      const decision = await work(raw);
      return {
        data: decision.finish === "commit" ? "released" : "rolled-back",
        nativeState: "transaction-active",
        stage: { kind: "decided", decision },
        phases: [],
        failure: null,
      };
    },
  };
  const pin: RawPin = {
    async begin<R>(work: (tx: RawTransaction) => Promise<Decision<R>>): Promise<Terminal<R>> {
      events.push("begin");
      const decision = await work(raw);
      events.push(decision.finish);
      return {
        data: decision.finish === "commit" ? "committed" : "rolled-back",
        nativeState: "idle",
        stage: { kind: "decided", decision },
        phases: [{ phase: decision.finish, acknowledgement: "confirmed-reply", failure: null }],
        failure: null,
      };
    },
    async release() {
      events.push("release");
      return { ok: true };
    },
    async discard() {
      events.push("discard");
      return { ok: true };
    },
    ...pinOverrides,
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
    async execute<Row>(statement: SqlStatement) {
      events.push(`pool.sql:${statement.text}`);
      return [] as Row[];
    },
    async checkout() {
      events.push("checkout");
      return { ok: true, value: pin };
    },
    close() {
      events.push("pool.close");
    },
    ...overrides,
  };
  const bindings = createDatabaseBindings({
    default: "test",
    connections: { test: { driver: "sqlite", filename: ":memory:" } },
  });
  const resource = bindings.find((item) => item.kind === "resource");
  assert.ok(resource, "generated declaration exposes the actual per-pool override identity");
  const app = createApplication({
    providers: [],
    services: bindings,
    shutdownTimeoutMs: 20,
    overrides: [
      resourceService(resource.token as ServiceToken<RawPool>, {
        lifetime: "application",
        dependencies: [],
        create: () => ({
          name: "synthetic database protocol pool",
          open: () => ({ ok: true, value: pool }),
          close: (owned) => owned.close(),
        }),
      }),
    ],
  });
  return { app, events, raw, pool };
}

test("synthetic ignored SQL retains actual query and application pool through bounded stop", async () => {
  const entered = deferred();
  const release = deferred();
  const fixture = syntheticPool({
    async execute<Row>() {
      entered.resolve();
      await release.promise;
      return [] as Row[];
    },
  });
  const { app, events } = fixture;
  await app.start();
  let query!: Promise<unknown>;
  const run = app.run((scope) => {
    query = scope.resolve(DATABASE_SESSION_TOKEN).execute(sql("gated"));
    return 7;
  });
  try {
    await bounded(entered.promise);
    await pending(run);
    assert.equal((await bounded(app.stop())).timedOut, true);
    assert.equal(events.includes("pool.close"), false);
    release.resolve();
    assert.equal(await bounded(run), 7);
    await bounded(query);
    assert.equal((await bounded(app.completion)).successful, true);
    assert.equal(events.filter((event) => event === "pool.close").length, 1);
  } finally {
    release.resolve();
    await Promise.allSettled([run, query]);
    await app.stop();
  }
});

test("synthetic early native failure joins actual late controller and J before disposal and public rejection", async () => {
  const entered = deferred();
  const continueBody = deferred();
  const nativeFailed = deferred();
  const marker = Symbol("synthetic native early failure");
  let actualController: Promise<unknown> | undefined;
  let controllerDecided = false;
  const fixture = syntheticPool(
    {},
    {
      async begin<R>(work: (tx: RawTransaction) => Promise<Decision<R>>): Promise<Terminal<R>> {
        actualController = work(fixture.raw).then((decision) => {
          controllerDecided = true;
          return decision;
        });
        void actualController.catch(() => {});
        await entered.promise;
        nativeFailed.resolve();
        throw marker;
      },
    },
  );
  const { app, events } = fixture;
  await app.start();
  let transaction!: Promise<unknown>;
  const run = app.run(async (scope) => {
    const db = scope.resolve(DATABASE_SESSION_TOKEN);
    transaction = db.transaction(async () => {
      entered.resolve();
      await continueBody.promise;
      events.push("late body finished");
      return 23;
    });
    return attempt(() => transaction);
  });
  try {
    await bounded(nativeFailed.promise);
    await pending(transaction);
    await pending(run);
    assert.equal(
      events.includes("release") || events.includes("discard"),
      false,
      "early adapter throw cannot dispose under actual running controller",
    );
    continueBody.resolve();
    const result = await bounded(run);
    assert.equal(result.ok, false);
    assert.equal(
      controllerDecided,
      true,
      "the actual entered controller reaches its late Decision",
    );
    if (!result.ok) {
      assert.ok(result.error instanceof PersistenceError);
      assert.equal(result.error.data, "unknown");
      assert.deepEqual(
        result.error.result,
        { ok: true, value: 23 },
        "public final report retains late Decision after actual C join",
      );
      assert.equal(Object.isFrozen(result.error.result), true);
    }
    assert.deepEqual(
      events.filter((event) => ["late body finished", "release", "discard"].includes(event)),
      ["late body finished", "discard"],
    );
  } finally {
    continueBody.resolve();
    await Promise.allSettled([run, transaction, actualController]);
    await app.stop();
  }
});

test("synthetic release acknowledgement precedes observer admission and observer failure preserves committed data", async () => {
  const releaseEntered = deferred();
  const releaseAck = deferred();
  const observerFailure = Symbol("postcommit observer");
  const fixture = syntheticPool(
    {},
    {
      async release(): Promise<DisposeAck> {
        fixture.events.push("release entered");
        releaseEntered.resolve();
        await releaseAck.promise;
        fixture.events.push("release acknowledged");
        return { ok: true };
      },
    },
  );
  const { app, events } = fixture;
  await app.start();
  let transaction!: Promise<unknown>;
  const run = app.run(async (scope) => {
    transaction = scope.resolve(DATABASE_SESSION_TOKEN).transaction((tx) => {
      tx.afterCommit(() => {
        events.push("observer");
        throw observerFailure;
      });
      return 7;
    });
    return attempt(() => transaction);
  });
  try {
    await bounded(releaseEntered.promise);
    await pending(transaction);
    assert.equal(events.includes("observer"), false);
    releaseAck.resolve();
    const result = await bounded(run);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error instanceof PersistenceError);
      assert.equal(result.error.code, "DATABASE_POST_COMMIT_FAILED");
      assert.equal(result.error.data, "committed");
      assert.equal(result.error.cause, observerFailure);
    }
    assert.deepEqual(
      events.filter((event) =>
        ["commit", "rollback", "release acknowledged", "observer"].includes(event),
      ),
      ["commit", "release acknowledged", "observer"],
    );
  } finally {
    releaseAck.resolve();
    await Promise.allSettled([run, transaction]);
    await app.stop();
  }
});

for (const disposal of ["discard-ack", "release-failure"] as const) {
  test(`synthetic ${disposal} keeps data disposition separate from physical ownership`, async () => {
    const nativeFailure = Symbol("uncertain commit");
    const releaseFailure = Symbol("release ownership retained");
    let observers = 0;
    const fixture = syntheticPool(
      {},
      {
        async begin<R>(work: (tx: RawTransaction) => Promise<Decision<R>>): Promise<Terminal<R>> {
          const decision = await work(fixture.raw);
          fixture.events.push("commit attempted");
          return {
            data: disposal === "discard-ack" ? "unknown" : "committed",
            nativeState: disposal === "discard-ack" ? "unknown" : "idle",
            stage: { kind: "decided", decision },
            phases: [
              {
                phase: "commit",
                acknowledgement: disposal === "discard-ack" ? "unknown" : "confirmed-reply",
                failure: disposal === "discard-ack" ? { error: nativeFailure } : null,
              },
              ...(disposal === "discard-ack"
                ? [
                    {
                      phase: "rollback" as const,
                      acknowledgement: "confirmed-reply" as const,
                      failure: null,
                    },
                  ]
                : []),
            ],
            failure: disposal === "discard-ack" ? { error: nativeFailure } : null,
          };
        },
        async release() {
          fixture.events.push("release failed");
          return { ok: false, error: releaseFailure, ownership: "retained" };
        },
      },
    );
    const { app, events } = fixture;
    await app.start();
    let waiterError: unknown;
    const run = app.run(async (scope) => {
      const result = await attempt(() =>
        scope.resolve(DATABASE_SESSION_TOKEN).transaction((tx) => {
          tx.afterCommit(() => {
            observers++;
          });
          return false;
        }),
      );
      if (!result.ok) waiterError = result.error;
      return result;
    });
    try {
      const runResult = await attempt(() => bounded(run));
      if (disposal === "discard-ack")
        assert.equal(
          runResult.ok,
          true,
          "confirmed discard discharges physical ownership while ordinary unknown transaction remains catchable",
        );
      else
        assert.equal(
          runResult.ok,
          false,
          "caught failed pin release remains strict in actual journal tree",
        );
      assert.ok(waiterError instanceof PersistenceError);
      assert.equal(waiterError.data, disposal === "discard-ack" ? "unknown" : "committed");
      assert.deepEqual(waiterError.result, { ok: true, value: false });
      assert.equal(observers, 0);
      assert.equal(
        events.filter((event) => event === "commit attempted").length,
        1,
        "uncertain commit/business work is never replayed",
      );
      assert.equal(
        events.filter((event) => event === "discard").length,
        disposal === "discard-ack" ? 1 : 0,
        "failed release is never retried with discard",
      );
      assert.equal(
        events.filter((event) => event === "release failed").length,
        disposal === "release-failure" ? 1 : 0,
      );
    } finally {
      await Promise.allSettled([run]);
      await app.stop();
    }
  });
}

test("SQLite captured outer spawn is not transaction J and live legitimate descendants retain branch authority", async () => {
  const app = createApplication({ providers: [], services: sqlite() });
  await app.start();
  try {
    const result = await app.run(async (outer) => {
      const db = outer.resolve(DATABASE_SESSION_TOKEN);
      const operations = outer.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
      const outcomes: boolean[] = [];
      await db.execute(sql("CREATE TABLE items (id INTEGER)"));
      await db.transaction(async (tx) => {
        await outer.spawn(async () => {
          outcomes.push((await attempt(() => tx.execute(sql("INSERT INTO items VALUES (90)")))).ok);
        });
        await operations.operation(async () => {
          outcomes.push((await attempt(() => tx.execute(sql("INSERT INTO items VALUES (1)")))).ok);
        });
      });
      return { outcomes, rows: await db.execute(sql("SELECT id FROM items")) };
    });
    assert.deepEqual(result.outcomes, [false, true]);
    assert.deepEqual(result.rows, [{ id: 1 }]);
  } finally {
    await app.stop();
  }
});

test("synthetic late checkout remains owned until actual pin outcome and failed execution publication drains it", async () => {
  const entered = deferred();
  const release = deferred();
  let pin!: RawPin;
  const fixture = syntheticPool({
    async checkout() {
      entered.resolve();
      await release.promise;
      return { ok: true, value: pin };
    },
  });
  pin = {
    async begin() {
      throw new Error("business must not start after cancelled acquisition");
    },
    async release() {
      fixture.events.push("late pin release");
      return { ok: true };
    },
    async discard() {
      fixture.events.push("late pin discard");
      return { ok: true };
    },
  };
  const { app, events } = fixture;
  await app.start();
  let bodies = 0;
  let transaction!: Promise<unknown>;
  const run = app.run((scope) => {
    transaction = scope.resolve(DATABASE_SESSION_TOKEN).transaction(() => {
      bodies++;
    });
    return 7;
  });
  try {
    await bounded(entered.promise);
    const stopped = await bounded(app.stop());
    assert.equal(stopped.timedOut, true);
    assert.equal(events.includes("pool.close"), false);
    await pending(run);
    release.resolve();
    await rejected(run);
    await rejected(transaction);
    assert.equal(bodies, 0);
    await bounded(app.completion);
    assert.deepEqual(
      events.filter((event) => event.startsWith("late pin")),
      ["late pin release"],
    );
  } finally {
    release.resolve();
    await Promise.allSettled([run, transaction]);
    await app.stop();
  }
});

test("synthetic SQL captures own text and parameter array before deferred native work", async () => {
  const entered = deferred();
  const release = deferred();
  let seen: unknown;
  const fixture = syntheticPool({
    async execute<Row>(statement: SqlStatement) {
      entered.resolve();
      await release.promise;
      seen = { text: statement.text, params: [...statement.params] };
      return [] as Row[];
    },
  });
  const { app } = fixture;
  const params = [7];
  const statement = { text: "SELECT ?", params };
  await app.start();
  const run = app.run((scope) => scope.resolve(DATABASE_SESSION_TOKEN).execute(statement));
  try {
    await bounded(entered.promise);
    statement.text = "MUTATED";
    params[0] = 99;
    params.push(100);
    release.resolve();
    await bounded(run);
    assert.deepEqual(seen, { text: "SELECT ?", params: [7] });
    assert.equal(
      Object.isFrozen(params),
      false,
      "snapshot never freezes caller-owned parameter arrays",
    );
  } finally {
    release.resolve();
    await Promise.allSettled([run]);
    await app.stop();
  }
});

test("synthetic callback arriving after closed C rejects before admitting business or mutating stages", async () => {
  const marker = Symbol("begin failed before callback entry");
  let lateCallback!: (tx: RawTransaction) => Promise<Decision<unknown>>;
  let bodies = 0;
  const fixture = syntheticPool(
    {},
    {
      async begin<R>(work: (tx: RawTransaction) => Promise<Decision<R>>): Promise<Terminal<R>> {
        lateCallback = work;
        throw marker;
      },
    },
  );
  const { app, events } = fixture;
  await app.start();
  try {
    const outcome = await app.run((scope) =>
      attempt(() =>
        scope.resolve(DATABASE_SESSION_TOKEN).transaction(() => {
          bodies++;
          return 7;
        }),
      ),
    );
    assert.equal(outcome.ok, false);
    const before = [...events];
    const late = await attempt(() => lateCallback(fixture.raw));
    assert.equal(late.ok, false);
    assert.equal(bodies, 0);
    assert.deepEqual(
      events,
      before,
      "closed callback cannot revive native business, commit, or disposal",
    );
  } finally {
    await app.stop();
  }
});

test("synthetic partial named-pool startup failure closes each actually acquired sibling exactly once", async () => {
  const first = syntheticPool();
  const marker = Symbol("second pool not acquired");
  const bindings = sqlite();
  const resources = bindings.filter((item) => item.kind === "resource");
  assert.equal(resources.length, 2);
  let opened = 0;
  let closed = 0;
  const app = createApplication({
    providers: [],
    services: bindings,
    overrides: resources.map((declaration, index) =>
      resourceService(declaration.token as ServiceToken<RawPool>, {
        lifetime: "application",
        dependencies: [],
        create: () => ({
          name: `synthetic startup pool ${index}`,
          open() {
            if (index === 1)
              return { ok: false as const, error: marker, disposition: "not-acquired" as const };
            opened++;
            return { ok: true as const, value: first.pool };
          },
          close() {
            closed++;
          },
        }),
      }),
    ),
  });
  try {
    await rejected(app.start());
    assert.equal(opened, 1);
    assert.equal(closed, 1, "partially acquired sibling is a separate actual journal resource");
  } finally {
    await app.stop();
  }
  assert.equal(closed, 1, "stop does not close the failed or already discharged pool");
});

for (const failureMode of ["sync throw", "promise reject"] as const) {
  test(`synthetic ignored transaction SQL ${failureMode} is joined and forces rollback-only`, async () => {
    const marker = Symbol(failureMode);
    const fixture = syntheticPool();
    fixture.raw.execute = <Row>(_statement: SqlStatement): Promise<readonly Row[]> => {
      fixture.events.push("native SQL failed");
      if (failureMode === "sync throw") throw marker;
      return Promise.reject(marker);
    };
    const { app, events } = fixture;
    await app.start();
    try {
      const outcome = await app.run((scope) =>
        attempt(() =>
          scope.resolve(DATABASE_SESSION_TOKEN).transaction((tx) => {
            void tx.execute(sql("ignored failure"));
            return 17;
          }),
        ),
      );
      assert.equal(outcome.ok, false);
      if (!outcome.ok) {
        assert.ok(outcome.error instanceof PersistenceError);
        assert.equal(outcome.error.code, "DATABASE_TRANSACTION_ROLLBACK_ONLY");
        assert.equal(outcome.error.data, "rolled-back");
        assert.deepEqual(outcome.error.result, { ok: true, value: 17 });
      }
      assert.deepEqual(
        events.filter((item) =>
          ["native SQL failed", "commit", "rollback", "release"].includes(item),
        ),
        ["native SQL failed", "rollback", "release"],
      );
    } finally {
      await app.stop();
    }
  });
}

test("synthetic uncertain savepoint poisons parent admission even when its waiter is caught", async () => {
  const marker = Symbol("uncertain savepoint native outcome");
  const fixture = syntheticPool();
  fixture.raw.savepoint = async <R>(work: (tx: RawTransaction) => Promise<Decision<R>>) => {
    const decision = await work(fixture.raw);
    return {
      data: "unknown",
      nativeState: "unknown",
      stage: { kind: "decided", decision },
      phases: [
        { phase: "release-savepoint", acknowledgement: "unknown", failure: { error: marker } },
      ],
      failure: { error: marker },
    };
  };
  const { app, events } = fixture;
  let child: Awaited<ReturnType<typeof attempt>> | undefined;
  let sibling: Awaited<ReturnType<typeof attempt>> | undefined;
  let parentSql: Awaited<ReturnType<typeof attempt>> | undefined;
  let observers = 0;
  await app.start();
  try {
    const result = await app.run((scope) =>
      attempt(() =>
        scope.resolve(DATABASE_SESSION_TOKEN).transaction(async (tx) => {
          tx.afterCommit(() => {
            observers++;
          });
          child = await attempt(() => tx.transaction(() => 7));
          sibling = await attempt(() => tx.transaction(() => 8));
          parentSql = await attempt(() =>
            tx.execute(sql("must not reach native after unknown child")),
          );
          return 19;
        }),
      ),
    );
    assert.equal(child?.ok, false);
    if (child && !child.ok) {
      assert.ok(child.error instanceof PersistenceError);
      assert.equal(child.error.data, "unknown");
    }
    assert.equal(sibling?.ok, false);
    assert.equal(parentSql?.ok, false);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error instanceof PersistenceError);
      assert.equal(result.error.data, "rolled-back");
      assert.deepEqual(result.error.result, { ok: true, value: 19 });
    }
    assert.equal(observers, 0);
    assert.equal(
      events.some((event) => event.startsWith("tx.sql:")),
      false,
    );
    assert.deepEqual(
      events.filter((event) => event === "commit" || event === "rollback"),
      ["rollback"],
    );
  } finally {
    await app.stop();
  }
});

test("invalid statements and transaction settings reject before effects without poisoning healthy work", async () => {
  const fixture = syntheticPool();
  const { app, events } = fixture;
  let getterReads = 0;
  const accessorParams = [1];
  Object.defineProperty(accessorParams, "0", {
    get() {
      getterReads++;
      return 1;
    },
  });
  const invalidStatements: unknown[] = [
    null,
    { text: " ", params: [] },
    { text: "SELECT ?", params: new Array(1) },
    { text: "SELECT ?", params: accessorParams },
    Object.defineProperty({ params: [] }, "text", {
      get() {
        getterReads++;
        return "SELECT 1";
      },
    }),
  ];
  const invalidOptions: unknown[] = [
    null,
    [],
    Object.create({ acquisitionSignal: new AbortController().signal }),
    { timeout: 1 },
    Object.defineProperty({}, "acquisitionSignal", {
      get() {
        getterReads++;
        return new AbortController().signal;
      },
      enumerable: true,
    }),
    { acquisitionSignal: { aborted: false } },
  ];
  await app.start();
  try {
    const result = await app.run(async (scope) => {
      const db = scope.resolve(DATABASE_SESSION_TOKEN);
      const statements = [];
      for (const value of invalidStatements)
        statements.push(await attempt(() => db.execute(value as never)));
      const options = [];
      for (const value of invalidOptions)
        options.push(await attempt(() => db.transaction(() => 0, value as never)));
      const invalidWork = await attempt(() => db.transaction(1 as never));
      const before = [...events];
      const txGuards: boolean[] = [];
      const value = await db.transaction(async (tx) => {
        txGuards.push((await attempt(() => tx.execute({ text: "", params: [] }))).ok);
        txGuards.push((await attempt(() => tx.transaction(1 as never))).ok);
        txGuards.push((await attempt(() => tx.afterCommit(1 as never))).ok);
        return 23;
      });
      return { statements, options, invalidWork, before, txGuards, value };
    });
    assert.ok(result.statements.every((item) => !item.ok));
    assert.ok(result.options.every((item) => !item.ok));
    assert.equal(result.invalidWork.ok, false);
    assert.deepEqual(result.before, [], "all rejected root input is pre-native and pre-checkout");
    assert.deepEqual(result.txGuards, [false, false, false]);
    assert.equal(result.value, 23, "pre-admission validation cannot poison a healthy transaction");
    assert.equal(getterReads, 0);
    assert.deepEqual(events, ["checkout", "begin", "commit", "release"]);
  } finally {
    await app.stop();
  }
});

test("configuration rejects malformed native options without native effects and accepts explicit finite settings", () => {
  const invalidConnections: unknown[] = [
    { driver: "pgsql", url: "https://secret.invalid/db" },
    { driver: "mysql", url: "postgres://secret.invalid/db" },
    { driver: "pgsql", url: "malformed" },
    { driver: "pgsql", url: "postgres://secret.invalid/db", max: 1.5 },
    { driver: "pgsql", url: "postgres://secret.invalid/db", idleTimeout: -1 },
    { driver: "pgsql", url: "postgres://secret.invalid/db", maxLifetime: Number.POSITIVE_INFINITY },
    { driver: "pgsql", url: "postgres://secret.invalid/db", connectionTimeout: "10" },
  ];
  for (const connection of invalidConnections)
    assert.throws(() =>
      createDatabaseBindings({ default: "main", connections: { main: connection as never } }),
    );
  const declarations = createDatabaseBindings({
    default: "pg",
    connections: {
      pg: {
        driver: "pgsql",
        url: "postgres://explicit.invalid/db",
        max: 1,
        idleTimeout: 0,
        maxLifetime: 1.5,
        connectionTimeout: 2,
      },
      mysql: { driver: "mysql", url: "mysql://explicit.invalid/db", max: 1 },
    },
  });
  assert.equal(
    declarations.filter((item) => item.kind === "resource").length,
    2,
    "validation/assembly creates descriptors without opening native connections",
  );
});

test("synthetic checkout options require genuine signals and advertised signal/metrics proof before effects", async () => {
  const unsupported = syntheticPool();
  const signal = new AbortController();
  const metrics = createTransactionAcquisitionMetrics();
  await unsupported.app.start();
  try {
    const outcomes = await unsupported.app.run(async (scope) => {
      const db = scope.resolve(DATABASE_SESSION_TOKEN);
      return [
        await attempt(() => db.transaction(() => 1, { acquisitionSignal: signal.signal })),
        await attempt(() => db.transaction(() => 1, { acquisitionMetrics: metrics })),
      ];
    });
    for (const result of outcomes) {
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(result.error instanceof PersistenceError);
        assert.equal(result.error.code, "DATABASE_UNSUPPORTED_CAPABILITY");
      }
    }
    assert.deepEqual(unsupported.events, []);
  } finally {
    await unsupported.app.stop();
  }
  let observedOptions: unknown;
  const enabled = syntheticPool({
    capabilities: Object.freeze({
      driver: "sqlite",
      transactions: true,
      savepoints: true,
      rowLocks: false,
      postgresRls: false,
      cancellableCheckout: true,
      observableCheckout: true,
      isolatedDiscard: false,
    }),
  });
  const originalCheckout = enabled.pool.checkout.bind(enabled.pool);
  enabled.pool.checkout = (options) => {
    observedOptions = options;
    return originalCheckout(options);
  };
  await enabled.app.start();
  try {
    const value = await enabled.app.run((scope) =>
      scope
        .resolve(DATABASE_SESSION_TOKEN)
        .transaction(() => 29, { acquisitionSignal: signal.signal, acquisitionMetrics: metrics }),
    );
    assert.equal(value, 29);
    assert.deepEqual(observedOptions, { signal: signal.signal, metrics });
    assert.equal(Object.isFrozen(observedOptions), true);
    const aborted = new AbortController();
    const marker = Symbol("pre-checkout abort");
    aborted.abort(marker);
    const before = [...enabled.events];
    const outcome = await enabled.app.run((scope) =>
      attempt(() =>
        scope
          .resolve(DATABASE_SESSION_TOKEN)
          .transaction(() => 30, { acquisitionSignal: aborted.signal }),
      ),
    );
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.error, marker);
    assert.deepEqual(
      enabled.events,
      before,
      "already-aborted genuine acquisition signal prevents checkout",
    );
  } finally {
    await enabled.app.stop();
  }
});

test("synthetic acquisition cancellation after checkout but before callback admission preserves confirmed rollback", async () => {
  const controller = new AbortController();
  const marker = Symbol("abort between checkout and J");
  const fixture = syntheticPool(
    {
      capabilities: Object.freeze({
        driver: "sqlite",
        transactions: true,
        savepoints: true,
        rowLocks: false,
        postgresRls: false,
        cancellableCheckout: true,
        observableCheckout: false,
        isolatedDiscard: false,
      }),
    },
    {
      async begin<R>(work: (tx: RawTransaction) => Promise<Decision<R>>): Promise<Terminal<R>> {
        controller.abort(marker);
        try {
          await work(fixture.raw);
          throw new Error("aborted admission unexpectedly entered");
        } catch (error) {
          return {
            data: "rolled-back",
            nativeState: "idle",
            stage: { kind: "callback-failed", error },
            phases: [{ phase: "rollback", acknowledgement: "confirmed-reply", failure: null }],
            failure: { error },
          };
        }
      },
    },
  );
  let bodies = 0;
  await fixture.app.start();
  try {
    const result = await fixture.app.run((scope) =>
      attempt(() =>
        scope.resolve(DATABASE_SESSION_TOKEN).transaction(
          () => {
            bodies++;
            return 7;
          },
          { acquisitionSignal: controller.signal },
        ),
      ),
    );
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.equal(
        result.error,
        marker,
        "sole callback admission rejection identity survives confirmed rollback",
      );
    assert.equal(bodies, 0);
    assert.equal(fixture.events.includes("release"), true);
    assert.equal(fixture.events.includes("discard"), false);
  } finally {
    await fixture.app.stop();
  }
});

test("synthetic observer pre-admission cancellation reports committed data after release without running observer", async () => {
  const external = new AbortController();
  const marker = Symbol("cancel after commit before observer");
  const fixture = syntheticPool(
    {},
    {
      async release() {
        fixture.events.push("release before cancel");
        external.abort(marker);
        return { ok: true };
      },
    },
  );
  let observers = 0;
  let outcome: Awaited<ReturnType<typeof attempt>> | undefined;
  await fixture.app.start();
  const run = fixture.app.run({ kind: "command", signal: external.signal }, async (scope) => {
    outcome = await attempt(() =>
      scope.resolve(DATABASE_SESSION_TOKEN).transaction((tx) => {
        tx.afterCommit(() => {
          observers++;
        });
        return 31;
      }),
    );
  });
  try {
    const execution = await attempt(() => bounded(run));
    assert.equal(
      execution.ok,
      true,
      "caught pre-admission observer rejection creates no skipped strict child",
    );
    assert.equal(outcome?.ok, false);
    if (outcome && !outcome.ok) {
      assert.ok(outcome.error instanceof PersistenceError);
      assert.equal(outcome.error.code, "DATABASE_POST_COMMIT_FAILED");
      assert.equal(outcome.error.data, "committed");
      assert.deepEqual(outcome.error.result, { ok: true, value: 31 });
      assert.equal(outcome.error.cause, marker);
    }
    assert.equal(observers, 0);
    assert.deepEqual(
      fixture.events.filter((item) =>
        ["commit", "rollback", "release before cancel"].includes(item),
      ),
      ["commit", "release before cancel"],
    );
  } finally {
    await Promise.allSettled([run]);
    await fixture.app.stop();
  }
});

for (const strictKind of ["cleanup", "skip"] as const) {
  test(`synthetic nested ${strictKind} stays strict exactly once when transaction waiters are caught`, async () => {
    const marker = Symbol(`nested ${strictKind}`);
    const external = new AbortController();
    const fixture = syntheticPool();
    let calls = 0;
    let cleanupCalls = 0;
    let childFailed = false;
    let outerFailed = false;
    await fixture.app.start();
    const run = fixture.app.run({ kind: "command", signal: external.signal }, async (scope) => {
      const db = scope.resolve(DATABASE_SESSION_TOKEN);
      const ownership = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
      const outer = await attempt(() =>
        db.transaction(async (parent) => {
          const child = parent.transaction(async () => {
            calls++;
            await ownership.joined(async (task) => {
              await task.acquire({
                name: "synthetic nested cleanup",
                open: () => ({ ok: true, value: 1 }),
                close() {
                  cleanupCalls++;
                  throw marker;
                },
              });
            });
            return 5;
          });
          if (strictKind === "skip") external.abort(marker);
          childFailed = !(await attempt(() => child)).ok;
          return 7;
        }),
      );
      outerFailed = !outer.ok;
    });
    try {
      const failure = await rejected(run);
      assert.equal(
        failure,
        marker,
        "kernel retains one exact strict occurrence, without controller re-appending inspected provenance",
      );
      assert.equal(childFailed, true);
      assert.equal(outerFailed, true);
      assert.equal(calls, strictKind === "cleanup" ? 1 : 0);
      assert.equal(cleanupCalls, strictKind === "cleanup" ? 1 : 0);
      assert.equal(fixture.events.includes("commit"), false);
    } finally {
      await Promise.allSettled([run]);
      await fixture.app.stop();
    }
  });
}

test("synthetic duplicate native callback during live C cannot admit a second business J", async () => {
  let duplicate: Awaited<ReturnType<typeof attempt>> | undefined;
  let bodies = 0;
  const fixture = syntheticPool(
    {},
    {
      async begin<R>(work: (tx: RawTransaction) => Promise<Decision<R>>): Promise<Terminal<R>> {
        const decision = await work(fixture.raw);
        duplicate = await attempt(() => work(fixture.raw));
        return {
          data: "committed",
          nativeState: "idle",
          stage: { kind: "decided", decision },
          phases: [{ phase: "commit", acknowledgement: "confirmed-reply", failure: null }],
          failure: null,
        };
      },
    },
  );
  await fixture.app.start();
  try {
    const value = await fixture.app.run((scope) =>
      scope.resolve(DATABASE_SESSION_TOKEN).transaction(() => {
        bodies++;
        return 37;
      }),
    );
    assert.equal(value, 37);
    assert.equal(bodies, 1);
    assert.equal(duplicate?.ok, false);
    if (duplicate && !duplicate.ok) {
      assert.ok(duplicate.error instanceof PersistenceError);
      assert.equal(duplicate.error.code, "DATABASE_TRANSACTION_FAILED");
    }
  } finally {
    await fixture.app.stop();
  }
});

test("SQLite nested explicit rollback preserves value and successful savepoints promote observers in order", async () => {
  const app = createApplication({ providers: [], services: sqlite() });
  const observers: number[] = [];
  await app.start();
  try {
    const result = await app.run(async (scope) => {
      const db = scope.resolve(DATABASE_SESSION_TOKEN);
      await db.execute(sql("CREATE TABLE promoted (id INTEGER)"));
      const value = await db.transaction(async (parent) => {
        parent.afterCommit(() => {
          observers.push(1);
        });
        const rollbackValue = await parent.transaction(async (child) => {
          await child.execute(sql("INSERT INTO promoted VALUES (90)"));
          child.afterCommit(() => {
            observers.push(90);
          });
          child.requestRollback();
          return false;
        });
        const childValue = await parent.transaction(async (child) => {
          await child.execute(sql("INSERT INTO promoted VALUES (2)"));
          child.afterCommit(() => {
            observers.push(2);
          });
          return 11;
        });
        parent.afterCommit(() => {
          observers.push(3);
        });
        return { rollbackValue, childValue };
      });
      return { value, rows: await db.execute(sql("SELECT id FROM promoted")) };
    });
    assert.deepEqual(result.value, { rollbackValue: false, childValue: 11 });
    assert.deepEqual(result.rows, [{ id: 2 }]);
    assert.deepEqual(observers, [1, 2, 3]);
  } finally {
    await app.stop();
  }
});

for (const failureMode of ["sync throw", "promise reject"] as const) {
  test(`synthetic root SQL ${failureMode} classifies actual error and remains recoverable`, async () => {
    const marker = { code: "SQLITE_CONSTRAINT_UNIQUE", message: "private raw SQL detail" };
    const fixture = syntheticPool({
      execute<Row>(): Promise<readonly Row[]> {
        if (failureMode === "sync throw") throw marker;
        return Promise.reject(marker);
      },
    });
    await fixture.app.start();
    try {
      const result = await fixture.app.run((scope) =>
        attempt(() => scope.resolve(DATABASE_SESSION_TOKEN).execute(sql("native root failure"))),
      );
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(result.error instanceof PersistenceError);
        assert.equal(result.error.code, "DATABASE_UNIQUE_CONSTRAINT");
        assert.equal(result.error.cause, marker);
        assert.equal(result.error.message, "A record with these values already exists.");
      }
      assert.deepEqual(fixture.events, [], "root SQL failure never checks out a transaction pin");
      assert.equal((await fixture.app.stop()).successful, true);
    } finally {
      await fixture.app.stop();
    }
  });
}

for (const payloadKind of ["same opaque aggregate", "same falsy primitive"] as const) {
  test(`synthetic business and cleanup ${payloadKind} occurrences remain distinct without flattening`, async () => {
    const marker =
      payloadKind === "same opaque aggregate"
        ? new AggregateError([0], "opaque user aggregate")
        : false;
    const fixture = syntheticPool();
    let cleanupCalls = 0;
    let transactionError: unknown;
    await fixture.app.start();
    const run = fixture.app.run(async (scope) => {
      const ownership = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
      const outcome = await attempt(() =>
        scope.resolve(DATABASE_SESSION_TOKEN).transaction(async () => {
          await ownership.joined(async (task) => {
            await task.acquire({
              name: "same-payload strict cleanup",
              open: () => ({ ok: true, value: 1 }),
              close() {
                cleanupCalls++;
                throw marker;
              },
            });
          });
          throw marker;
        }),
      );
      if (!outcome.ok) transactionError = outcome.error;
    });
    try {
      assert.equal(
        await rejected(run),
        marker,
        "the one strict cleanup occurrence remains once in the original execution tree",
      );
      assert.equal(cleanupCalls, 1);
      assert.ok(transactionError instanceof PersistenceError);
      assert.equal(transactionError.data, "rolled-back");
      assert.deepEqual(transactionError.result, { ok: false, error: marker });
      assert.ok(transactionError.cause instanceof AggregateError);
      assert.equal(
        transactionError.cause.errors.length,
        2,
        "ordinary body and strict cleanup are two occurrences even with identical payload",
      );
      assert.equal(transactionError.cause.errors[0], marker);
      assert.equal(transactionError.cause.errors[1], marker);
      assert.equal(Object.isFrozen(transactionError.cause), true);
      assert.equal(Object.isFrozen(transactionError.cause.errors), true);
    } finally {
      await Promise.allSettled([run]);
      await fixture.app.stop();
    }
  });
}

test("synthetic malformed array proxy length descriptor rejects before root or transaction SQL effects", async () => {
  let descriptorReads = 0;
  const params = new Proxy([], {
    getOwnPropertyDescriptor(target, key) {
      if (key === "length") {
        descriptorReads++;
        return { value: Number.NaN, writable: true, enumerable: false, configurable: false };
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const fixture = syntheticPool();
  await fixture.app.start();
  try {
    const result = await fixture.app.run(async (scope) => {
      const db = scope.resolve(DATABASE_SESSION_TOKEN);
      const root = await attempt(() => db.execute(sql("SELECT ?", params)));
      let child: Awaited<ReturnType<typeof attempt>> | undefined;
      const value = await db.transaction(async (tx) => {
        child = await attempt(() => tx.execute(sql("SELECT ?", params)));
        return 43;
      });
      return { root, child, value };
    });
    assert.equal(result.root.ok, false);
    assert.equal(result.child?.ok, false);
    assert.equal(result.value, 43);
    assert.equal(descriptorReads, 2);
    assert.deepEqual(
      fixture.events,
      ["checkout", "begin", "commit", "release"],
      "malformed parameter descriptors have no native SQL effect or rollback poison",
    );
  } finally {
    await fixture.app.stop();
  }
});

for (const nativeEvidence of [
  "unknown without failure",
  "tagged falsy failure without phases",
] as const) {
  test(`synthetic early native terminal ${nativeEvidence} retains late business result and immediately poisons SQL`, async () => {
    const entered = deferred();
    const resume = deferred();
    const nativeReturned = deferred();
    let actualController: Promise<unknown> | undefined;
    let lateSql: Awaited<ReturnType<typeof attempt>> | undefined;
    let controllerDecided = false;
    const fixture = syntheticPool(
      {},
      {
        async begin<R>(work: (tx: RawTransaction) => Promise<Decision<R>>): Promise<Terminal<R>> {
          actualController = work(fixture.raw).then((decision) => {
            controllerDecided = true;
            return decision;
          });
          void actualController.catch(() => {});
          await entered.promise;
          nativeReturned.resolve();
          return {
            data: "unknown",
            nativeState: "unknown",
            stage: { kind: "callback-running" },
            phases: [],
            failure: nativeEvidence === "unknown without failure" ? null : { error: false },
          };
        },
      },
    );
    await fixture.app.start();
    let transaction!: Promise<unknown>;
    const run = fixture.app.run(async (scope) => {
      transaction = scope.resolve(DATABASE_SESSION_TOKEN).transaction(async (tx) => {
        entered.resolve();
        await resume.promise;
        lateSql = await attempt(() => tx.execute(sql("must reject after native failure")));
        return 47;
      });
      return attempt(() => transaction);
    });
    try {
      await bounded(nativeReturned.promise);
      // Let the controller receive the actual terminal and poison the active branch.
      await new Promise<void>((resolve) => setImmediate(resolve));
      await pending(transaction);
      assert.equal(fixture.events.includes("release") || fixture.events.includes("discard"), false);
      resume.resolve();
      const result = await bounded(run);
      assert.equal(lateSql?.ok, false);
      assert.equal(controllerDecided, true);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(result.error instanceof PersistenceError);
        assert.equal(result.error.data, "unknown");
        assert.deepEqual(result.error.result, { ok: true, value: 47 });
        if (nativeEvidence === "tagged falsy failure without phases")
          assert.equal(result.error.cause, false);
      }
      assert.equal(
        fixture.events.some((event) => event.startsWith("tx.sql:")),
        false,
      );
      assert.deepEqual(
        fixture.events.filter((event) => event === "release" || event === "discard"),
        ["discard"],
      );
    } finally {
      resume.resolve();
      await Promise.allSettled([run, transaction, actualController]);
      await fixture.app.stop();
    }
  });
}

test("synthetic unsupported savepoints and invalid callbacks reject before native effects while parent can commit", async () => {
  const fixture = syntheticPool({
    capabilities: Object.freeze({
      driver: "sqlite",
      transactions: true,
      savepoints: false,
      rowLocks: false,
      postgresRls: false,
      cancellableCheckout: false,
      observableCheckout: false,
      isolatedDiscard: false,
    }),
  });
  let savepoints = 0;
  fixture.raw.savepoint = async () => {
    savepoints++;
    throw new Error("unsupported savepoint reached native");
  };
  await fixture.app.start();
  try {
    const result = await fixture.app.run((scope) =>
      scope.resolve(DATABASE_SESSION_TOKEN).transaction(async (parent) => {
        const unsupported = await attempt(() => parent.transaction(() => 1));
        const invalidNested = await attempt(() => parent.transaction(undefined as never));
        const invalidObserver = await attempt(() => parent.afterCommit(undefined as never));
        return { unsupported, invalidNested, invalidObserver };
      }),
    );
    assert.equal(result.unsupported.ok, false);
    if (!result.unsupported.ok) {
      assert.ok(result.unsupported.error instanceof PersistenceError);
      assert.equal(result.unsupported.error.code, "DATABASE_UNSUPPORTED_CAPABILITY");
    }
    assert.equal(result.invalidNested.ok, false);
    if (!result.invalidNested.ok) assert.ok(result.invalidNested.error instanceof TypeError);
    assert.equal(result.invalidObserver.ok, false);
    if (!result.invalidObserver.ok) assert.ok(result.invalidObserver.error instanceof TypeError);
    assert.equal(savepoints, 0);
    assert.deepEqual(fixture.events, ["checkout", "begin", "commit", "release"]);
  } finally {
    await fixture.app.stop();
  }
});

test("synthetic internal joined admission rejection starts no business node and is reported without a fabricated result", async () => {
  const marker = Symbol("internal J admission revoked");
  const fixture = syntheticPool();
  let calls = 0;
  let joins = 0;
  await fixture.app.start();
  try {
    const result = await fixture.app.run(async (scope) => {
      const actual = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
      // Narrow fault at the actual internal admission seam: all admitted C work/resources
      // still use the real kernel port. The injected J rejection reserves no second node.
      const ownership: OwnedExecution = {
        joined(work, enter) {
          joins++;
          if (joins === 2) return Promise.reject(marker);
          return actual.joined(work, enter);
        },
      };
      const runtime = new TransactionRuntime(
        scope.resolve(CORE_EXECUTION_CONTEXT_TOKEN),
        scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN),
        ownership,
      );
      return attempt(() =>
        runtime.run(fixture.pool, () => {
          calls++;
          return 53;
        }),
      );
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error instanceof PersistenceError);
      assert.equal(result.error.data, "rolled-back");
      assert.equal(result.error.cause, marker);
      assert.equal(Object.hasOwn(result.error, "result"), false);
    }
    assert.equal(calls, 0);
    assert.equal(joins, 2);
    assert.deepEqual(fixture.events, ["checkout", "begin", "rollback", "release"]);
  } finally {
    await fixture.app.stop();
  }
});
