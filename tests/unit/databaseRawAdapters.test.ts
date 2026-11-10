import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resourceService } from "../../src/core/contracts/services";
import type { ServiceToken } from "../../src/core/contracts/token";
import { createTransactionAcquisitionMetrics } from "../../src/core/database/acquisitionMetrics";
import { createDatabaseBindings } from "../../src/core/database/bindings";
import type { RawPin, RawPool, Terminal } from "../../src/core/database/driverPorts";
import { loadMysql, resetMysqlLoaderForTests } from "../../src/core/database/mysqlNative";
import {
  createMysqlPin,
  createRawMysqlPool,
  destroyMysqlConnection,
} from "../../src/core/database/rawMysql";
import {
  createRawSqlitePool,
  openRawSqlitePool,
  sqliteFilename,
} from "../../src/core/database/rawSqlite";
import { DATABASE_SESSION_TOKEN } from "../../src/core/database/tokens";
import { createApplication } from "../../src/core/runtime/application";

type Exchange = { sql: string; rows?: unknown; reject?: { error: unknown } };
function mysqlFixture(
  exchanges: readonly Exchange[],
  options: {
    acquireError?: unknown;
    destroyError?: unknown;
    releaseError?: unknown;
    omitCheckout?: boolean;
    gatedDestroy?: boolean;
  } = {},
) {
  const pending = [...exchanges];
  const calls: string[] = [];
  let config: unknown;
  const socket = new EventEmitter();
  const destroyed = gate();
  const connection = {
    connection: { stream: socket },
    async execute(sql: string, params?: unknown[]) {
      calls.push(sql);
      const expected = pending.shift();
      assert.ok(expected, `unexpected native exchange ${sql}`);
      assert.equal(sql, expected.sql);
      assert.deepEqual(params, []);
      if (expected.reject) throw expected.reject.error;
      return [expected.rows ?? [], []] as [unknown, unknown];
    },
    async beginTransaction() {
      calls.push("BEGIN");
    },
    async commit() {
      calls.push("COMMIT");
    },
    async rollback() {
      calls.push("ROLLBACK");
    },
    release() {
      calls.push("release");
      if (Object.hasOwn(options, "releaseError")) throw options.releaseError;
    },
    destroy() {
      calls.push("destroy");
      destroyed.resolve();
      if (Object.hasOwn(options, "destroyError")) throw options.destroyError;
      assert.ok(socket.listenerCount("close") > 0, "close witness must be attached before destroy");
      if (!options.gatedDestroy) socket.emit("close");
    },
  };
  const pool = {
    execute: connection.execute,
    async end() {
      calls.push("pool.end");
    },
    on(event: string, listener: (value: unknown) => void) {
      assert.equal(event, "connection");
      // mysql2's physical-connection hook has callback query, unlike PromisePoolConnection.
      listener({
        query(sql: string, callback: (error: unknown) => void) {
          calls.push(`physical:${sql}`);
          callback(undefined);
        },
      });
    },
    ...(options.omitCheckout
      ? {}
      : {
          async getConnection() {
            calls.push("checkout");
            if (Object.hasOwn(options, "acquireError")) throw options.acquireError;
            return connection;
          },
        }),
  };
  return {
    calls,
    destroyed: destroyed.promise,
    unblockDestroyWait: destroyed.resolve,
    closeSocket: () => socket.emit("close"),
    install() {
      resetMysqlLoaderForTests(async () => ({
        createPool(value: unknown) {
          config = value;
          return pool;
        },
      }));
    },
    done() {
      assert.deepEqual(pending, []);
    },
    config: () => config,
  };
}
async function eventLoopTurn() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const utc = (): Exchange[] => [
  { sql: "SET time_zone = '+00:00'" },
  {
    sql: "SELECT @@session.time_zone AS strata_session_timezone",
    rows: [{ strata_session_timezone: "+00:00" }],
  },
];

test("raw MySQL factory confirms UTC on each acquired connection before SQL or pin publication", async () => {
  const fixture = mysqlFixture([
    ...utc(),
    { sql: "SELECT packed_boundary", rows: [{ owned: 7 }] },
    ...utc(),
  ]);
  fixture.install();
  let pool: Awaited<ReturnType<typeof createRawMysqlPool>> | undefined;
  try {
    pool = await createRawMysqlPool({
      driver: "mysql",
      url: "mysql://fixture.invalid/owned",
      max: 1,
    });
    expect(fixture.config()).toEqual({
      uri: "mysql://fixture.invalid/owned",
      timezone: "Z",
      connectionLimit: 1,
    });
    expect(pool.capabilities.cancellableCheckout).toBe(false);
    expect(pool.capabilities.observableCheckout).toBe(false);
    expect(await pool.execute({ text: "SELECT packed_boundary", params: [] })).toEqual([
      { owned: 7 },
    ]);
    const outcome = await pool.checkout();
    assert.equal(outcome.ok, true);
    const terminal = await outcome.value.begin(async () => ({ finish: "commit", result: 1 }));
    expect(terminal.data).toBe("committed");
    expect(await outcome.value.release()).toEqual({ ok: true });
    expect(fixture.calls).toEqual([
      "physical:SET time_zone = '+00:00'",
      "checkout",
      "SET time_zone = '+00:00'",
      "SELECT @@session.time_zone AS strata_session_timezone",
      "SELECT packed_boundary",
      "release",
      "checkout",
      "SET time_zone = '+00:00'",
      "SELECT @@session.time_zone AS strata_session_timezone",
      "BEGIN",
      "COMMIT",
      "release",
    ]);
    fixture.done();
  } finally {
    await pool?.close();
    resetMysqlLoaderForTests();
  }
});

test("raw MySQL initialization failures destroy uninitialized pins and report cleanup ownership", async () => {
  const initError = Object.freeze({ phase: "initialization" });
  const destroyError = Object.freeze({ phase: "destruction" });
  for (const scenario of ["set-reject", "timezone-mismatch", "destroy-reject"] as const) {
    const fixture = mysqlFixture(
      scenario === "timezone-mismatch"
        ? [
            { sql: "SET time_zone = '+00:00'" },
            {
              sql: "SELECT @@session.time_zone AS strata_session_timezone",
              rows: [{ strata_session_timezone: "SYSTEM" }],
            },
          ]
        : [{ sql: "SET time_zone = '+00:00'", reject: { error: initError } }],
      scenario === "destroy-reject" ? { destroyError } : {},
    );
    fixture.install();
    let pool: Awaited<ReturnType<typeof createRawMysqlPool>> | undefined;
    try {
      pool = await createRawMysqlPool({ driver: "mysql", url: "mysql://fixture.invalid/owned" });
      const outcome = await pool.checkout();
      assert.equal(outcome.ok, false);
      expect(outcome.disposition).toBe(scenario === "destroy-reject" ? "unknown" : "cleaned");
      if (scenario !== "timezone-mismatch") expect(outcome.error).toBe(initError);
      else expect(outcome.error).toBeInstanceOf(Error);
      if (scenario === "destroy-reject") expect(outcome.cleanupErrors).toEqual([destroyError]);
      expect(fixture.calls.filter((call) => call === "destroy")).toHaveLength(1);
      expect(fixture.calls.includes("release")).toBe(false);
      fixture.done();
    } finally {
      if (scenario === "destroy-reject" && pool) {
        const retainedPool = pool;
        await assert.rejects(
          async () => await retainedPool.close(),
          (error: unknown) => error === destroyError,
        );
        expect(fixture.calls.includes("pool.end")).toBe(false);
      } else await pool?.close();
      resetMysqlLoaderForTests();
    }
  }
});

test("raw MySQL SQL execution never publishes an uninitialized connection and releases a failed initialized query", async () => {
  const initError = { init: true };
  const sqlError = { query: true };
  for (const initialized of [false, true]) {
    const fixture = mysqlFixture(
      initialized
        ? [...utc(), { sql: "SELECT native_failure", reject: { error: sqlError } }]
        : [{ sql: "SET time_zone = '+00:00'", reject: { error: initError } }],
    );
    fixture.install();
    let pool: Awaited<ReturnType<typeof createRawMysqlPool>> | undefined;
    try {
      pool = await createRawMysqlPool({ driver: "mysql", url: "mysql://fixture.invalid/owned" });
      await assert.rejects(
        pool.execute({ text: "SELECT native_failure", params: [] }),
        (error) => error === (initialized ? sqlError : initError),
      );
      expect(fixture.calls.at(-1)).toBe(initialized ? "release" : "destroy");
      expect(fixture.calls.filter((call) => call === "release" || call === "destroy")).toHaveLength(
        1,
      );
      fixture.done();
    } finally {
      await pool?.close();
      resetMysqlLoaderForTests();
    }
  }
});

test("raw MySQL rejects unsupported checkout observations before effects and rejects closed acquisition", async () => {
  const fixture = mysqlFixture([]);
  fixture.install();
  let pool: Awaited<ReturnType<typeof createRawMysqlPool>> | undefined;
  try {
    pool = await createRawMysqlPool({ driver: "mysql", url: "mysql://fixture.invalid/owned" });
    const before = [...fixture.calls];
    for (const checkout of [
      { signal: new AbortController().signal },
      { metrics: createTransactionAcquisitionMetrics() },
    ]) {
      const outcome = await pool.checkout(checkout);
      assert.equal(outcome.ok, false);
      expect(outcome.disposition).toBe("not-acquired");
    }
    expect(fixture.calls).toEqual(before);
    await pool.close();
    const outcome = await pool.checkout();
    assert.equal(outcome.ok, false);
    expect(outcome.disposition).toBe("not-acquired");
    await assert.rejects(pool.execute({ text: "SELECT forbidden", params: [] }), /pool is closed/);
    expect(fixture.calls).toEqual([...before, "pool.end"]);
    fixture.done();
  } finally {
    // Already closed on the normal path; do not retry disposal after an unknown failure.
    resetMysqlLoaderForTests();
  }
});

test("raw MySQL failed checkout and missing native checkout capability are not acquired", async () => {
  const error = Object.freeze({ checkout: true });
  for (const omitCheckout of [false, true]) {
    const fixture = mysqlFixture([], { acquireError: error, omitCheckout });
    fixture.install();
    let pool: Awaited<ReturnType<typeof createRawMysqlPool>> | undefined;
    try {
      pool = await createRawMysqlPool({ driver: "mysql", url: "mysql://fixture.invalid/owned" });
      const outcome = await pool.checkout();
      assert.equal(outcome.ok, false);
      expect(outcome.disposition).toBe("not-acquired");
      if (!omitCheckout) expect(outcome.error).toBe(error);
      expect(fixture.calls.includes("destroy")).toBe(false);
      expect(fixture.calls.includes("release")).toBe(false);
      fixture.done();
    } finally {
      await pool?.close();
      resetMysqlLoaderForTests();
    }
  }
});

test("actual SQLite initialization enables foreign keys, snapshots codecs and supports real raw pin lifecycle", async () => {
  const pool = createRawSqlitePool({ driver: "sqlite", filename: ":memory:" });
  let pin: RawPin | undefined;
  try {
    expect(await pool.execute({ text: "PRAGMA foreign_keys", params: [] })).toEqual([
      { foreign_keys: 1 },
    ]);
    expect(pool.capabilities.isolatedDiscard).toBe(false);
    expect(pool.capabilities.cancellableCheckout).toBe(false);
    await pool.execute({ text: "CREATE TABLE sample(value TEXT)", params: [] });
    const when = new Date("2026-11-10T12:34:56.000Z");
    await pool.execute({ text: "INSERT INTO sample VALUES(?)", params: [when] });
    expect(await pool.execute({ text: "SELECT value FROM sample", params: [] })).toEqual([
      { value: when.toISOString() },
    ]);
    const unsupported = await pool.checkout({ metrics: createTransactionAcquisitionMetrics() });
    assert.equal(unsupported.ok, false);
    expect(unsupported.disposition).toBe("not-acquired");
    const outcome = await pool.checkout();
    assert.equal(outcome.ok, true);
    pin = outcome.value;
    assert.throws(() => pool.close(), /Drain SQLite/);
    const result = await outcome.value.begin(async (tx) => {
      await tx.execute({ text: "INSERT INTO sample VALUES('rolled-back')", params: [] });
      return { finish: "rollback", result: false };
    });
    expect(result.data).toBe("rolled-back");
    expect(await outcome.value.release()).toEqual({ ok: true });
    expect(await outcome.value.release()).toEqual({ ok: true });
    await assert.rejects(
      outcome.value.begin(async () => ({ finish: "commit", result: 0 })),
      /no longer active/,
    );
    expect(await pool.execute({ text: "SELECT value FROM sample", params: [] })).toEqual([
      { value: when.toISOString() },
    ]);
  } finally {
    await pin?.release();
    await pool.close();
  }
});

test("actual SQLite initialization rejects missing parent and discard quarantines its unique handle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strata-raw-init-"));
  try {
    assert.throws(() => sqliteFilename(" "), /not configured/);
    expect(sqliteFilename(":memory:")).toBe(":memory:");
    const failedOpen = openRawSqlitePool({
      driver: "sqlite",
      filename: join(directory, "missing", "owned.sqlite"),
    });
    assert.equal(failedOpen.ok, false);
    expect(failedOpen.disposition).toBe("unknown");
    expect(failedOpen.error).toBeInstanceOf(Error);
    const invalidConfig = openRawSqlitePool({ driver: "sqlite", filename: " " });
    assert.equal(invalidConfig.ok, false);
    expect(invalidConfig.disposition).toBe("not-acquired");
    const pool = createRawSqlitePool({
      driver: "sqlite",
      filename: join(directory, "owned.sqlite"),
    });
    try {
      const outcome = await pool.checkout();
      assert.equal(outcome.ok, true);
      const discarded = await outcome.value.discard();
      assert.equal(discarded.ok, false);
      expect(discarded.ownership).toBe("retained");
      expect(await outcome.value.release()).toBe(discarded);
      await assert.rejects(pool.execute({ text: "SELECT 1", params: [] }), /quarantined/);
      const denied = await pool.checkout();
      assert.equal(denied.ok, false);
      expect(denied.disposition).toBe("not-acquired");
    } finally {
      await pool.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("MySQL pin discard waits for actual socket close and never retries disposition", async () => {
  const socket = Object.assign(new EventEmitter(), { destroyed: false });
  const started = gate();
  let destroys = 0;
  const connection = {
    connection: { stream: socket },
    async execute(): Promise<[unknown, unknown]> {
      throw new Error("unexpected SQL");
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {
      assert.fail("discard must not release");
    },
    destroy() {
      assert.ok(socket.listenerCount("close") > 0, "observer installed before destruction");
      destroys++;
      socket.destroyed = true;
      started.resolve();
    },
  };
  const pin = createMysqlPin(connection);
  const actual = pin.discard();
  let settled = false;
  const observation = actual.then((result) => {
    settled = true;
    return result;
  });
  try {
    await started.promise;
    await eventLoopTurn();
    expect(socket.destroyed).toBe(true);
    assert.equal(
      settled,
      false,
      "destroyed flag and void native return are not close acknowledgements",
    );
    expect(pin.discard()).toBe(actual);
    expect(pin.release()).toBe(actual);
    socket.emit("close");
    expect(await observation).toEqual({ ok: true });
    expect(destroys).toBe(1);
    expect(socket.listenerCount("close")).toBe(0);
    await assert.rejects(
      pin.begin(async () => ({ finish: "commit", result: 0 })),
      /no longer available/,
    );
  } finally {
    socket.emit("close");
    await Promise.allSettled([actual, observation]);
  }
});

test("MySQL destroy helper distinguishes missing close witness, already closed and falsy destruction failure", async () => {
  let destroys = 0;
  const base = {
    async execute(): Promise<[unknown, unknown]> {
      throw new Error("unexpected SQL");
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    destroy() {
      destroys++;
    },
  };
  const missing = await destroyMysqlConnection(base);
  assert.equal(missing.ok, false);
  expect(missing.ownership).toBe("unknown");
  expect(destroys).toBe(1);
  const closed = Object.assign(new EventEmitter(), { closed: true });
  expect(await destroyMysqlConnection({ ...base, connection: { stream: closed } })).toEqual({
    ok: true,
  });
  expect(closed.listenerCount("close")).toBe(0);
  const socket = new EventEmitter();
  const failed = await destroyMysqlConnection({
    ...base,
    connection: { stream: socket },
    destroy() {
      throw false;
    },
  });
  assert.equal(failed.ok, false);
  expect(failed.error).toBe(false);
  expect(failed.ownership).toBe("unknown");
  expect(socket.listenerCount("close")).toBe(0);
});

test("MySQL initialization failure remains pending until failed connection destruction is actually acknowledged", async () => {
  for (const method of ["checkout", "execute"] as const) {
    const error = Object.freeze({ initialization: method });
    const fixture = mysqlFixture([{ sql: "SET time_zone = '+00:00'", reject: { error } }], {
      gatedDestroy: true,
    });
    fixture.install();
    let pool: Awaited<ReturnType<typeof createRawMysqlPool>> | undefined;
    let actual: Promise<unknown> | undefined;
    let observation: Promise<unknown> | undefined;
    let settled = false;
    try {
      pool = await createRawMysqlPool({ driver: "mysql", url: "mysql://fixture.invalid/owned" });
      actual =
        method === "checkout"
          ? pool.checkout()
          : pool.execute({ text: "SELECT never_admitted", params: [] });
      observation = actual.then(
        (value) => {
          settled = true;
          return { ok: true as const, value };
        },
        (failure: unknown) => {
          settled = true;
          return { ok: false as const, failure };
        },
      );
      void observation.then(() => fixture.unblockDestroyWait());
      await fixture.destroyed;
      await eventLoopTurn();
      expect(settled).toBe(false);
      expect(fixture.calls.includes("SELECT never_admitted")).toBe(false);
      fixture.closeSocket();
      if (method === "checkout")
        expect(await observation).toEqual({
          ok: true,
          value: { ok: false, error, disposition: "cleaned" },
        });
      else expect(await observation).toEqual({ ok: false, failure: error });
      fixture.done();
    } finally {
      fixture.closeSocket();
      await Promise.allSettled([actual, observation]);
      await pool?.close();
      resetMysqlLoaderForTests();
    }
  }
});

test("MySQL optional native loader shares one pending import and supports retry without exposing import failure details", async () => {
  const imported = gate();
  const release = gate();
  let calls = 0;
  const api = {
    createPool() {
      throw new Error("unused in loader contract");
    },
  };
  let first: ReturnType<typeof loadMysql> | undefined;
  let second: ReturnType<typeof loadMysql> | undefined;
  try {
    resetMysqlLoaderForTests(async () => {
      calls++;
      imported.resolve();
      await release.promise;
      return { default: api };
    });
    first = loadMysql();
    second = loadMysql();
    await imported.promise;
    expect(calls).toBe(1);
    release.resolve();
    expect(await first).toBe(api);
    expect(await second).toBe(api);
    expect(await loadMysql()).toBe(api);
    expect(calls).toBe(1);
  } finally {
    release.resolve();
    await Promise.allSettled([first, second]);
    resetMysqlLoaderForTests();
  }
  const opaque = { importer: "opaque" };
  let attempt = 0;
  try {
    resetMysqlLoaderForTests(async () => {
      attempt++;
      if (attempt === 1) throw opaque;
      return api;
    });
    await assert.rejects(
      loadMysql(),
      (error) =>
        error instanceof Error &&
        error.cause === opaque &&
        error.message === "Install mysql2 to open a MySQL connection (`bun add mysql2`).",
    );
    expect(await loadMysql()).toBe(api);
    expect(attempt).toBe(2);
    resetMysqlLoaderForTests(async () => ({}));
    await assert.rejects(loadMysql(), /did not export createPool/);
  } finally {
    resetMysqlLoaderForTests();
  }
});

test("caught actual raw MySQL query cleanup failure retains application resource and rejects fresh native admission", async () => {
  const sqlError = Object.freeze({ nativeSQL: "opaque query rejection" });
  const cleanupError = Object.freeze({ physicalRelease: "opaque retained cleanup" });
  const fixture = mysqlFixture(
    [...utc(), { sql: "SELECT failing_owned_query", reject: { error: sqlError } }],
    { releaseError: cleanupError },
  );
  fixture.install();
  let app: ReturnType<typeof createApplication> | undefined;
  try {
    const raw = await createRawMysqlPool({ driver: "mysql", url: "mysql://fixture.invalid/owned" });
    const bindings = createDatabaseBindings({
      default: "owned",
      connections: { owned: { driver: "mysql", url: "mysql://fixture.invalid/owned" } },
    });
    const generatedPool = bindings.find((declaration) => declaration.kind === "resource");
    assert.ok(generatedPool);
    // ServiceDeclaration intentionally erases its value type; this actual generated
    // database resource token is the binding's RawPool slot, preserving token identity.
    const actualPoolToken = generatedPool.token as ServiceToken<RawPool>;
    app = createApplication({
      providers: [],
      services: bindings,
      overrides: [
        resourceService(actualPoolToken, {
          lifetime: "application",
          dependencies: [],
          create: () => ({
            name: "owned actual raw MySQL pool",
            open: () => ({ ok: true, value: raw }),
            close: () => raw.close(),
          }),
        }),
      ],
    });
    await app.start();
    let caught = false;
    await app.run(async (scope) => {
      const session = scope.resolve(DATABASE_SESSION_TOKEN);
      await assert.rejects(session.execute({ text: "SELECT failing_owned_query", params: [] }));
      caught = true;
      await assert.rejects(
        session.execute({ text: "SELECT forbidden_new_native_admission", params: [] }),
      );
    });
    expect(caught).toBe(true);
    expect(fixture.calls.filter((call) => call === "checkout")).toHaveLength(1);
    expect(fixture.calls.filter((call) => call === "release")).toHaveLength(1);
    expect(fixture.calls.includes("destroy")).toBe(false);
    const stop = await app.stop();
    expect(stop.successful).toBe(false);
    expect(stop.snapshot.retainedResources).toContain("owned actual raw MySQL pool");
    expect(stop.snapshot.errors.some((diagnostic) => diagnostic.error === cleanupError)).toBe(true);
    expect(fixture.calls.includes("pool.end")).toBe(false);
    await assert.rejects(
      async () => await raw.close(),
      (error: unknown) => error === cleanupError,
    );
    expect(fixture.calls.filter((call) => call === "release")).toHaveLength(1);
    fixture.done();
  } finally {
    await app?.stop();
    if (app) await app.completion;
    resetMysqlLoaderForTests();
  }
});

test("actual SQLite initialization observes close once and retains exact failed-close ownership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strata-sqlite-init-close-"));
  const descriptor = Object.getOwnPropertyDescriptor(Database.prototype, "close");
  assert.ok(descriptor);
  const originalClose = Database.prototype.close;
  try {
    for (const failClose of [false, true]) {
      const corruptPath = join(
        directory,
        failClose ? "failed-close.sqlite" : "confirmed-close.sqlite",
      );
      await writeFile(corruptPath, "This unique fixture is not a SQLite database.");
      const cleanupError = Object.freeze({ sqliteCleanup: "owned close failure" });
      let closeCalls = 0;
      let captured: Database | undefined;
      Object.defineProperty(Database.prototype, "close", {
        ...descriptor,
        value(this: Database, ...args: Parameters<Database["close"]>) {
          if (this.filename === corruptPath) {
            closeCalls++;
            captured = this;
            if (failClose) throw cleanupError;
          }
          return originalClose.apply(this, args);
        },
      });
      try {
        const outcome = openRawSqlitePool({ driver: "sqlite", filename: corruptPath });
        assert.equal(outcome.ok, false);
        assert.equal(closeCalls, 1);
        assert.ok(captured, "actual allocated handle must reach native close");
        expect(outcome.error).toBeInstanceOf(Error);
        expect(outcome.disposition).toBe(failClose ? "unknown" : "cleaned");
        if (failClose) expect(outcome.cleanupErrors).toEqual([cleanupError]);
        else expect(outcome.cleanupErrors).toBeUndefined();
      } finally {
        Object.defineProperty(Database.prototype, "close", descriptor);
        // The injected failed close intentionally retains the actual unique handle.
        // Only the test's finally repairs that fixture using the original method.
        if (failClose && captured) originalClose.call(captured);
      }
    }
  } finally {
    Object.defineProperty(Database.prototype, "close", descriptor);
    await rm(directory, { recursive: true, force: true });
  }
});

test("MySQL physical disposal preserves observer registration and cleanup failures without false ACK", async () => {
  const primary = Object.freeze({ closeObserver: "registration or native failure" });
  const cleanup = Object.freeze({ closeObserver: "listener cleanup failure" });
  let destroys = 0;
  const base = {
    async execute(): Promise<[unknown, unknown]> {
      throw new Error("unexpected SQL");
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    destroy() {
      destroys++;
      throw primary;
    },
  };
  const missing = await destroyMysqlConnection(base);
  assert.equal(missing.ok, false);
  assert.equal(missing.error, primary);
  assert.equal(missing.ownership, "unknown");
  assert.equal(destroys, 1);
  const brokenRegistration = {
    once() {
      throw primary;
    },
    removeListener() {
      throw cleanup;
    },
  };
  const combined = await destroyMysqlConnection({
    ...base,
    connection: { stream: brokenRegistration },
  });
  assert.equal(combined.ok, false);
  assert.equal(combined.ownership, "unknown");
  assert.ok(combined.error instanceof AggregateError);
  assert.deepEqual(combined.error.errors, [primary, cleanup]);
  assert.equal(destroys, 1, "failed registration cannot be followed by unobserved destruction");
  let observer: (() => void) | undefined;
  const brokenCleanup = {
    once(_event: "close", listener: () => void) {
      observer = listener;
    },
    removeListener() {
      throw cleanup;
    },
  };
  const unacknowledged = await destroyMysqlConnection({
    ...base,
    connection: { stream: brokenCleanup },
    destroy() {
      assert.ok(observer);
      observer();
    },
  });
  assert.equal(unacknowledged.ok, false);
  assert.equal(unacknowledged.error, cleanup);
  assert.equal(unacknowledged.ownership, "unknown");
});

test("MySQL savepoint controls use the native unprepared query port while values remain bound", async () => {
  const calls: string[] = [];
  const pin = createMysqlPin({
    async execute(sql, params): Promise<[unknown, unknown]> {
      calls.push(sql);
      assert.equal(sql, "SELECT ? AS value");
      assert.deepEqual(params, [12]);
      return [[{ value: 12 }], []];
    },
    async query(sql): Promise<[unknown, unknown]> {
      calls.push(sql);
      assert.ok(
        [
          "SAVEPOINT strata_sp_1",
          "ROLLBACK TO SAVEPOINT strata_sp_1",
          "RELEASE SAVEPOINT strata_sp_1",
        ].includes(sql),
      );
      return [{ affectedRows: 0 }, []];
    },
    async beginTransaction() {
      calls.push("BEGIN");
    },
    async commit() {
      calls.push("COMMIT");
    },
    async rollback() {
      calls.push("ROLLBACK");
    },
    release() {
      calls.push("release");
    },
    destroy() {
      assert.fail("known idle pin must release");
    },
  });
  try {
    const terminal = await pin.begin(async (tx) => {
      const child = await tx.savepoint(async (nested) => {
        assert.deepEqual(await nested.execute({ text: "SELECT ? AS value", params: [12] }), [
          { value: 12 },
        ]);
        return { finish: "rollback", result: false };
      });
      assert.equal(child.data, "rolled-back");
      return { finish: "commit", result: 13 };
    });
    assert.equal(terminal.data, "committed");
    assert.deepEqual(terminal.stage, {
      kind: "decided",
      decision: { finish: "commit", result: 13 },
    });
    assert.deepEqual(calls, [
      "BEGIN",
      "SAVEPOINT strata_sp_1",
      "SELECT ? AS value",
      "ROLLBACK TO SAVEPOINT strata_sp_1",
      "RELEASE SAVEPOINT strata_sp_1",
      "COMMIT",
    ]);
  } finally {
    assert.deepEqual(await pin.release(), { ok: true });
  }
});

test("actual SQLite queued SQL rejection does not block the next admitted query", async () => {
  const pool = createRawSqlitePool({ driver: "sqlite", filename: ":memory:" });
  const failed = pool.execute({
    text: "SELECT missing_column FROM no_such_owned_table",
    params: [],
  });
  const following = pool.execute({ text: "SELECT 17 AS value", params: [] });
  try {
    await assert.rejects(failed);
    assert.deepEqual(await following, [{ value: 17 }]);
  } finally {
    await Promise.allSettled([failed, following]);
    await pool.close();
  }
});

test("actual SQLite premature release quarantines an active logical slot and does not return it to the queue", async () => {
  const pool = createRawSqlitePool({ driver: "sqlite", filename: ":memory:" });
  const entered = gate();
  const release = gate();
  let actual: Promise<Terminal<number>> | undefined;
  try {
    const opened = await pool.checkout();
    assert.equal(opened.ok, true);
    actual = opened.value.begin(async () => {
      entered.resolve();
      await release.promise;
      return { finish: "commit", result: 1 };
    });
    void actual.then(
      () => entered.resolve(),
      () => entered.resolve(),
    );
    await entered.promise;
    const disposal = await opened.value.release();
    assert.equal(disposal.ok, false);
    assert.equal(disposal.ownership, "retained");
    assert.strictEqual(await opened.value.discard(), disposal);
    await assert.rejects(pool.execute({ text: "SELECT 1", params: [] }), /quarantined/);
    const rejected = await pool.checkout();
    assert.equal(rejected.ok, false);
    assert.equal(rejected.disposition, "not-acquired");
    release.resolve();
    assert.equal((await actual).data, "unknown");
  } finally {
    release.resolve();
    await Promise.allSettled([actual]);
    await pool.close();
  }
});

test("SQLite legacy raw factory preserves initialization failure and composes actual failed cleanup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strata-sqlite-wrapper-close-"));
  const descriptor = Object.getOwnPropertyDescriptor(Database.prototype, "close");
  assert.ok(descriptor);
  const originalClose = Database.prototype.close;
  try {
    for (const failClose of [false, true]) {
      const filename = join(directory, failClose ? "retained.sqlite" : "closed.sqlite");
      await writeFile(filename, "This unique fixture is not SQLite.");
      const cleanupError = Object.freeze({ legacyWrapper: "native close failure" });
      let captured: Database | undefined;
      let closeCalls = 0;
      Object.defineProperty(Database.prototype, "close", {
        ...descriptor,
        value(this: Database, ...args: Parameters<Database["close"]>) {
          if (this.filename === filename) {
            closeCalls++;
            captured = this;
            if (failClose) throw cleanupError;
          }
          return originalClose.apply(this, args);
        },
      });
      try {
        assert.throws(
          () => createRawSqlitePool({ driver: "sqlite", filename }),
          (error: unknown) => {
            assert.ok(error instanceof Error);
            if (failClose) {
              assert.ok(error instanceof AggregateError);
              assert.equal(error.errors.length, 2);
              assert.ok(error.errors[0] instanceof Error);
              assert.equal(error.errors[1], cleanupError);
            } else assert.equal(error instanceof AggregateError, false);
            return true;
          },
        );
        assert.equal(closeCalls, 1);
        assert.ok(captured);
      } finally {
        Object.defineProperty(Database.prototype, "close", descriptor);
        if (failClose && captured) originalClose.call(captured);
      }
    }
  } finally {
    Object.defineProperty(Database.prototype, "close", descriptor);
    await rm(directory, { recursive: true, force: true });
  }
});
