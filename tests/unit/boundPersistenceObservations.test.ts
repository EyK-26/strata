import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resourceService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { createOwnedReadOnlyObservation } from "@getstrata/core/database/ownedReadOnlyObservation";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import {
  createFailedJobMetricsCollector,
  type FailedJobMetricsCollector,
} from "@getstrata/core/queue/failedJobMetrics";
import { createApplication } from "@getstrata/core/runtime/application";
import { bounded, deferred, pending } from "../fixtures/applicationOwnershipSupport";

const observe = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );

test("BP8 read-only collector times out its waiter while actual callback keeps application cleanup joined", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bound-observation-"));
  const filename = join(directory, "selected.sqlite");
  const closed: string[] = [];
  const Sentinel = createServiceToken<object>("observation.close.sentinel");
  const app = createApplication({
    providers: [],
    services: [
      ...createDatabaseBindings({
        default: "main",
        connections: { main: { driver: "sqlite", filename } },
      }),
      resourceService(Sentinel, {
        lifetime: "application",
        dependencies: [],
        create: () => ({
          name: "observation.close.sentinel",
          open: () => ({ ok: true, value: {} }),
          close: () => {
            closed.push("close");
          },
        }),
      }),
    ],
  });
  const entered = deferred();
  const release = deferred();
  let stop: ReturnType<typeof app.stop> | undefined;
  let collected: ReturnType<typeof observe> | undefined;
  let collector: FailedJobMetricsCollector | undefined;
  let closing: Promise<void> | undefined;
  await app.start();
  try {
    await app.run(async (scope) => {
      const db = scope.resolve(DATABASE_SESSION_TOKEN);
      await db.execute({ text: "CREATE TABLE failed_job (id INTEGER PRIMARY KEY)", params: [] });
      await db.execute({ text: "INSERT INTO failed_job VALUES (37)", params: [] });
    });
    const collect = createOwnedReadOnlyObservation(app, "main", { driver: "sqlite", filename });
    collector = createFailedJobMetricsCollector({
      timeoutMs: 1500,
      observeReadOnly: (timeout, work) =>
        collect(timeout, async (database, remaining) => {
          assert.deepEqual(
            await database.execute({ text: "SELECT id FROM failed_job", params: [] }),
            [{ id: 37 }],
          );
          await assert.rejects(
            database.execute({ text: "INSERT INTO failed_job VALUES (99)", params: [] }),
          );
          const snapshot = await work(database, remaining);
          entered.resolve();
          await release.promise;
          return snapshot;
        }),
    });
    collected = observe(collector.collect());
    await bounded(
      Promise.race([
        entered.promise,
        collected.then((outcome) => {
          if (!outcome.ok) throw outcome.error;
          throw new Error("Collector settled before callback entry");
        }),
      ]),
      "real read-only callback entry",
      3000,
    );
    const timedOut = await bounded(collected, "collector timeout waiter", 3000);
    assert.equal(
      timedOut.ok,
      false,
      "Timeout ends the collector waiter without adopting its held callback",
    );
    closing = collector.close();
    await pending(closing);
    stop = app.stop();
    await pending(stop);
    assert.deepEqual(closed, [], "Actual callback ownership prevents app resource/pool close");
    release.resolve();
    await bounded(stop, "actual callback join and app stop");
    assert.deepEqual(closed, ["close"]);
  } finally {
    release.resolve();
    await Promise.allSettled([collected, closing, stop]);
    await collector?.close();
    await app.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("owned read-only observations reject only the same live application connection transaction", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bound-observation-lineage-"));
  const main = { driver: "sqlite" as const, filename: join(directory, "main.sqlite") };
  const other = { driver: "sqlite" as const, filename: join(directory, "other.sqlite") };
  // Reusing declarations must still give each original application its own owner identity.
  const services = createDatabaseBindings({ default: "main", connections: { main, other } });
  const app = createApplication({ providers: [], services });
  const foreign = createApplication({ providers: [], services });
  const own = createOwnedReadOnlyObservation(app, "main", main);
  const otherPool = createOwnedReadOnlyObservation(app, "other", other);
  const foreignApp = createOwnedReadOnlyObservation(foreign, "main", main);
  const gate = deferred();
  let stale: Promise<unknown> | undefined;
  let deniedCallbackAdmissions = 0;
  const read = (observation: typeof own) =>
    observation(1000, async (database) => {
      assert.deepEqual(await database.execute({ text: "SELECT 71 AS value", params: [] }), [
        { value: 71 },
      ]);
      await assert.rejects(
        database.execute({ text: "CREATE TABLE forbidden (id INTEGER)", params: [] }),
      );
      return "observed";
    });
  await app.start();
  await foreign.start();
  try {
    await app.run(async (scope) => {
      const database = scope.resolve(DATABASE_SESSION_TOKEN);
      await database.transaction(async (selected) => {
        await selected.execute({ text: "SELECT 1", params: [] });
        await assert.rejects(
          own(1000, async () => {
            deniedCallbackAdmissions++;
          }),
          /independent transaction/,
        );
        assert.equal(deniedCallbackAdmissions, 0);
        await selected.transaction(async (nested) => {
          await assert.rejects(
            own(1000, async () => {
              deniedCallbackAdmissions++;
            }),
            /independent transaction/,
          );
          assert.equal(deniedCallbackAdmissions, 0);
          assert.equal(await read(otherPool), "observed");
          assert.equal(await read(foreignApp), "observed");
          await nested.execute({ text: "SELECT 1", params: [] });
        });
        // A different app's nested transaction cannot conceal the live parent owner.
        await foreign.run(async (otherScope) => {
          await otherScope
            .resolve(DATABASE_SESSION_TOKEN)
            .connection("other")
            .transaction(async () => {
              await assert.rejects(
                own(1000, async () => {
                  deniedCallbackAdmissions++;
                }),
                /independent transaction/,
              );
              assert.equal(deniedCallbackAdmissions, 0);
            });
        });
        assert.equal(
          await read(otherPool),
          "observed",
          "A different configured pool remains independent",
        );
        assert.equal(
          await read(foreignApp),
          "observed",
          "A reused declaration in another app has independent ownership",
        );
        await selected.execute({ text: "SELECT 1", params: [] });
        // This callback retains the original ALS lineage, but its transaction ends before admission.
        stale = gate.promise.then(() => read(own));
      });
    });
    gate.resolve();
    assert.equal(
      await stale,
      "observed",
      "A terminal transaction lineage cannot deny new observations",
    );
    const invalid = createOwnedReadOnlyObservation(app, "missing", main);
    await assert.rejects(read(invalid), /Unknown read-only observation connection/);
  } finally {
    gate.resolve();
    await Promise.allSettled([stale]);
    const stopped = await Promise.all([app.stop(), foreign.stop()]);
    rmSync(directory, { recursive: true, force: true });
    assert.ok(stopped.every((result) => result.successful));
  }
});

import type { ReadOnlyObservationExecutor } from "@getstrata/core/database/ownedReadOnlyObservation";

test("read-only observation validates public admission and expires its real isolated SQLite executor", async () => {
  const directory = mkdtempSync(join(tmpdir(), "observation-admission-"));
  const filename = join(directory, "selected.sqlite");
  const options = { driver: "sqlite" as const, filename };
  let effects = 0;
  let callbacks = 0;
  let captured: ReadOnlyObservationExecutor | undefined;
  const app = createApplication({
    providers: [
      {
        name: "observation.admission",
        setup() {
          effects++;
        },
      },
    ],
    services: createDatabaseBindings({ default: "main", connections: { main: options } }),
  });
  const read = createOwnedReadOnlyObservation(app, "main", options);
  const work = async () => {
    callbacks++;
  };
  try {
    assert.throws(
      () =>
        createOwnedReadOnlyObservation(app, "main", options, { postgresPolicy: "tenant" } as never),
      /Unsupported PostgreSQL observation policy/,
    );
    for (const timeout of [0, -1, 1.5, 5001, Infinity, NaN])
      assert.throws(() => read(timeout, work), /SQL observation timeout/);
    assert.throws(() => read(1000, null as never), /requires a callback/);
    assert.equal(effects, 0);
    assert.equal(callbacks, 0);
    await app.start();
    await app.run(async (scope) => {
      const db = scope.resolve(DATABASE_SESSION_TOKEN);
      await db.execute({ text: "CREATE TABLE observation_admission (value INTEGER)", params: [] });
      await db.execute({ text: "INSERT INTO observation_admission VALUES (67)", params: [] });
    });
    const mismatch = createOwnedReadOnlyObservation(app, "main", {
      driver: "mysql",
      url: "mysql://unused.invalid/no-connection-allowed",
    });
    await assert.rejects(mismatch(1000, work), /driver differs from the selected connection/);
    assert.equal(
      callbacks,
      0,
      "Driver mismatch rejects before callback or foreign-driver acquisition",
    );
    // Both declarations and observer captured this original config, not its later mutations.
    Reflect.set(options, "driver", "unsupported");
    options.filename = join(directory, "must-not-open.sqlite");
    await read(1000, async (database) => {
      callbacks++;
      captured = database;
      assert.equal(database.dialect.driver, "sqlite");
      assert.deepEqual(
        await database.execute({ text: "SELECT value FROM observation_admission", params: [] }),
        [{ value: 67 }],
      );
      await assert.rejects(
        database.execute({ text: "INSERT INTO observation_admission VALUES (99)", params: [] }),
      );
    });
    assert.equal(callbacks, 1);
    assert.ok(captured);
    let getterEffects = 0;
    const expiredStatement = Object.defineProperty({}, "text", {
      enumerable: true,
      get() {
        getterEffects++;
        return "INSERT INTO observation_admission VALUES (101)";
      },
    });
    let rejected: Promise<readonly unknown[]> | undefined;
    assert.doesNotThrow(() => {
      rejected = captured?.execute(expiredStatement as never);
    });
    assert.ok(rejected instanceof Promise);
    await assert.rejects(
      rejected,
      (error: unknown) =>
        error instanceof Error && Reflect.get(error, "code") === "APPLICATION_SCOPE_EXPIRED",
    );
    assert.equal(
      getterEffects,
      0,
      "Expired ownership denies before reading the supplied statement",
    );
    await app.run(async (scope) => {
      assert.deepEqual(
        await scope
          .resolve(DATABASE_SESSION_TOKEN)
          .execute({ text: "SELECT value FROM observation_admission", params: [] }),
        [{ value: 67 }],
      );
    });
  } finally {
    const stopped = await app.stop();
    rmSync(directory, { recursive: true, force: true });
    assert.equal(stopped.successful, true);
    assert.deepEqual(stopped.snapshot.retainedResources, []);
  }
});
