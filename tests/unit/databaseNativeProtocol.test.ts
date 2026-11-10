import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import type {
  Decision,
  NativeState,
  RawTransaction,
  SqlStatement,
} from "../../src/core/database/driverPorts";
import type { MysqlPoolConnection } from "../../src/core/database/mysqlNative";
import { type NativeControl, nativeTransaction } from "../../src/core/database/nativeTransactions";
import { createMysqlPin } from "../../src/core/database/rawMysql";

type Step = Readonly<{
  sql: string;
  command?: string;
  reject?: { error: unknown };
  state?: NativeState;
}>;
function scripted(steps: readonly Step[], initialProof?: NativeState) {
  const pending = [...steps];
  const calls: string[] = [];
  const executions: SqlStatement[] = [];
  let proof = initialProof;
  const control: NativeControl = {
    async execute<Row>(statement: SqlStatement): Promise<readonly Row[]> {
      executions.push(statement);
      return [];
    },
    async control(sql) {
      calls.push(sql);
      const next = pending.shift();
      assert.ok(next, `unexpected native control ${sql}`);
      assert.equal(sql, next.sql);
      if (next.state !== undefined) proof = next.state;
      if (next.reject) throw next.reject.error;
      return { command: next.command };
    },
    ...(initialProof === undefined ? {} : { state: () => proof ?? "unknown" }),
  };
  return {
    protocol: nativeTransaction(control),
    calls,
    executions,
    done: () => assert.deepEqual(pending, []),
  };
}
const commit = <T>(result: T): Decision<T> => ({ finish: "commit", result });
const rollback = <T>(result: T): Decision<T> => ({ finish: "rollback", result });
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("native BEGIN failure never admits callback and preserves exact falsy failure", async () => {
  const native = scripted([{ sql: "BEGIN", reject: { error: 0 }, state: "idle" }], "idle");
  let entered = false;
  const result = await native.protocol.begin(async () => {
    entered = true;
    return commit(1);
  });
  expect(entered).toBe(false);
  expect(result.data).toBe("not-started");
  expect(result.stage).toEqual({ kind: "callback-not-entered" });
  expect(result.failure?.error).toBe(0);
  expect(result.phases[0]?.acknowledgement).toBe("proven-not-applied");
  native.done();
});

test("native uncertain BEGIN is unknown rather than assumed not started", async () => {
  const error = Object.freeze({ opaque: "begin failure" });
  const native = scripted([{ sql: "BEGIN", reject: { error } }]);
  const result = await native.protocol.begin(async () => commit(1));
  expect(result.data).toBe("unknown");
  expect(result.nativeState).toBe("unknown");
  expect(result.failure?.error).toBe(error);
  expect(result.stage.kind).toBe("callback-not-entered");
  native.done();
});

test("later ROLLBACK ACK cannot resolve unknown COMMIT disposition", async () => {
  const error = Object.freeze({ opaque: "commit reply lost" });
  const native = scripted([
    { sql: "BEGIN" },
    { sql: "COMMIT", reject: { error } },
    { sql: "ROLLBACK" },
  ]);
  const result = await native.protocol.begin(async () => commit(false));
  assert.equal(result.data, "unknown");
  expect(result.nativeState).toBe("idle");
  expect(result.stage).toEqual({ kind: "decided", decision: { finish: "commit", result: false } });
  expect(result.failure?.error).toBe(error);
  expect(result.phases.map(({ phase, acknowledgement }) => [phase, acknowledgement])).toEqual([
    ["begin", "confirmed-reply"],
    ["commit", "unknown"],
    ["rollback", "confirmed-reply"],
  ]);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.phases)).toBe(true);
  expect(result.phases.every(Object.isFrozen)).toBe(true);
  expect(Object.isFrozen(result.stage)).toBe(true);
  native.done();
});

test("independent active-transaction proof plus rollback ACK proves rollback", async () => {
  const error = new Error("native COMMIT rejected while original transaction active");
  const native = scripted(
    [
      { sql: "BEGIN" },
      { sql: "COMMIT", reject: { error }, state: "transaction-active" },
      { sql: "ROLLBACK", state: "idle" },
    ],
    "idle",
  );
  const result = await native.protocol.begin(async () => commit(undefined));
  expect(result.data).toBe("rolled-back");
  expect(result.failure?.error).toBe(error);
  expect(result.phases[1]?.acknowledgement).toBe("proven-not-applied");
  expect(result.stage).toEqual({
    kind: "decided",
    decision: { finish: "commit", result: undefined },
  });
  native.done();
});

test("active proof without actual rollback ACK remains unknown and keeps both failures", async () => {
  const first = { commit: true };
  const second = { rollback: true };
  const native = scripted(
    [
      { sql: "BEGIN" },
      { sql: "COMMIT", reject: { error: first }, state: "transaction-active" },
      { sql: "ROLLBACK", reject: { error: second }, state: "unknown" },
    ],
    "idle",
  );
  const result = await native.protocol.begin(async () => commit(12));
  expect(result.data).toBe("unknown");
  expect(result.failure?.error).toBe(first);
  expect(result.phases[1]?.failure?.error).toBe(first);
  expect(result.phases[2]?.failure?.error).toBe(second);
  native.done();
});

test("confirmed COMMIT never emits rollback, and rollback-valued COMMIT reply is truthful", async () => {
  for (const command of ["COMMIT", "ROLLBACK"]) {
    const native = scripted([{ sql: "BEGIN" }, { sql: "COMMIT", command }]);
    const result = await native.protocol.begin(async () => commit(null));
    expect(result.data).toBe(command === "COMMIT" ? "committed" : "rolled-back");
    expect(result.failure).toBe(null);
    expect(result.nativeState).toBe("idle");
    expect(native.calls).toEqual(["BEGIN", "COMMIT"]);
    native.done();
  }
});

test("opaque falsy callback failures remain entered failures after confirmed rollback", async () => {
  for (const error of [undefined, false, 0, ""]) {
    const native = scripted([{ sql: "BEGIN" }, { sql: "ROLLBACK" }]);
    const result = await native.protocol.begin(async () => {
      throw error;
    });
    expect(result.data).toBe("rolled-back");
    assert.equal(result.stage.kind, "callback-failed");
    expect(result.stage.error).toBe(error);
    expect(result.failure).toBe(null);
    native.done();
  }
});

test("explicit rollback preserves falsy result and invalid decisions roll back", async () => {
  const native = scripted([{ sql: "BEGIN" }, { sql: "ROLLBACK" }]);
  const result = await native.protocol.begin(async () => rollback(0));
  expect(result.stage).toEqual({ kind: "decided", decision: { finish: "rollback", result: 0 } });
  expect(result.data).toBe("rolled-back");
  native.done();
  const invalid = scripted([{ sql: "BEGIN" }, { sql: "ROLLBACK" }]);
  const failed = await invalid.protocol.begin(
    async () => ({ finish: "invalid", result: 1 }) as unknown as Decision<number>,
  );
  assert.equal(failed.stage.kind, "callback-failed");
  expect(failed.stage.error).toBeInstanceOf(TypeError);
  expect(failed.data).toBe("rolled-back");
  invalid.done();
});

test("savepoint entry failure reports callback not entered and no invented child rollback", async () => {
  const error = { savepoint: true };
  const native = scripted([
    { sql: "BEGIN" },
    { sql: "SAVEPOINT strata_sp_1", reject: { error } },
    { sql: "ROLLBACK" },
  ]);
  let entered = false;
  const root = await native.protocol.begin(async (tx) => {
    const child = await tx.savepoint(async () => {
      entered = true;
      return commit(1);
    });
    expect(child.data).toBe("unknown");
    expect(child.stage.kind).toBe("callback-not-entered");
    expect(child.failure?.error).toBe(error);
    return rollback(undefined);
  });
  expect(root.stage).toEqual({
    kind: "decided",
    decision: { finish: "rollback", result: undefined },
  });
  expect(entered).toBe(false);
  native.done();
});

test("savepoint rollback needs both ROLLBACK TO and RELEASE ACKs", async () => {
  const error = { release: true };
  const native = scripted([
    { sql: "BEGIN" },
    { sql: "SAVEPOINT strata_sp_1" },
    { sql: "ROLLBACK TO SAVEPOINT strata_sp_1" },
    { sql: "RELEASE SAVEPOINT strata_sp_1", reject: { error } },
    { sql: "ROLLBACK" },
  ]);
  const root = await native.protocol.begin(async (tx) => {
    const child = await tx.savepoint(async () => rollback(false));
    expect(child.data).toBe("unknown");
    expect(child.failure?.error).toBe(error);
    expect(child.stage).toEqual({
      kind: "decided",
      decision: { finish: "rollback", result: false },
    });
    expect(child.phases.map(({ phase }) => phase)).toEqual([
      "savepoint",
      "rollback-to",
      "release-savepoint",
    ]);
    return rollback(undefined);
  });
  expect(root.stage).toEqual({
    kind: "decided",
    decision: { finish: "rollback", result: undefined },
  });
  native.done();
});

test("failed savepoint release recovery reports rollback only after both acknowledgements", async () => {
  const error = { release: true };
  const native = scripted([
    { sql: "BEGIN" },
    { sql: "SAVEPOINT strata_sp_1" },
    { sql: "RELEASE SAVEPOINT strata_sp_1", reject: { error } },
    { sql: "ROLLBACK TO SAVEPOINT strata_sp_1" },
    { sql: "RELEASE SAVEPOINT strata_sp_1" },
    { sql: "COMMIT" },
  ]);
  const result = await native.protocol.begin(async (tx) => {
    const child = await tx.savepoint(async () => commit(7));
    expect(child.data).toBe("rolled-back");
    expect(child.failure?.error).toBe(error);
    expect(child.stage).toEqual({ kind: "decided", decision: { finish: "commit", result: 7 } });
    return commit(8);
  });
  expect(result.data).toBe("committed");
  native.done();
});

test("raw branch and concurrent pin guards reject before executing native work", async () => {
  const native = scripted([
    { sql: "BEGIN" },
    { sql: "SAVEPOINT strata_sp_1" },
    { sql: "RELEASE SAVEPOINT strata_sp_1" },
    { sql: "COMMIT" },
  ]);
  const entered = gate();
  const release = gate();
  let savedRoot: RawTransaction | undefined;
  let savedChild: RawTransaction | undefined;
  const statement = { text: "SELECT owned", params: [] };
  let actual: Promise<unknown> | undefined;
  try {
    actual = native.protocol.begin(async (tx) => {
      savedRoot = tx;
      const child = tx.savepoint(async (nested) => {
        savedChild = nested;
        entered.resolve();
        await release.promise;
        await nested.execute(statement);
        return commit(1);
      });
      await entered.promise;
      await assert.rejects(tx.execute(statement), /branch is not active/);
      await assert.rejects(
        tx.savepoint(async () => commit(2)),
        /branch is not active/,
      );
      release.resolve();
      await child;
      await tx.execute(statement);
      return commit(3);
    });
    void actual.catch(() => entered.resolve());
    await entered.promise;
    await assert.rejects(
      native.protocol.begin(async () => commit(4)),
      /active transaction/,
    );
    const result = await actual;
    expect(result).toMatchObject({
      data: "committed",
      stage: { kind: "decided", decision: { finish: "commit", result: 3 } },
    });
    assert.ok(savedRoot);
    assert.ok(savedChild);
    await assert.rejects(savedRoot.execute(statement), /branch is not active/);
    await assert.rejects(savedChild.execute(statement), /branch is not active/);
    await assert.rejects(
      savedRoot.savepoint(async () => commit(5)),
      /branch is not active/,
    );
    expect(native.executions).toEqual([statement, statement]);
    native.done();
  } finally {
    release.resolve();
    await Promise.allSettled([actual]);
  }
});

test("actual SQLite deferred constraint exposes active proof before acknowledged rollback", async () => {
  const database = new Database(":memory:");
  const calls: string[] = [];
  try {
    database.exec("PRAGMA foreign_keys=ON");
    database.exec("CREATE TABLE parent(id INTEGER PRIMARY KEY)");
    database.exec(
      "CREATE TABLE child(parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)",
    );
    const protocol = nativeTransaction({
      async execute<Row>(statement: SqlStatement): Promise<readonly Row[]> {
        assert.equal(statement.params.length, 0);
        database.exec(statement.text);
        return [];
      },
      async control(sql) {
        calls.push(sql);
        database.exec(sql);
        return {};
      },
      state: () => (database.inTransaction ? "transaction-active" : "idle"),
    });
    const result = await protocol.begin(async (tx) => {
      await tx.execute({ text: "INSERT INTO child VALUES(42)", params: [] });
      return commit("body-completed");
    });
    expect(result.data).toBe("rolled-back");
    expect(result.nativeState).toBe("idle");
    expect(result.stage).toEqual({
      kind: "decided",
      decision: { finish: "commit", result: "body-completed" },
    });
    expect(result.phases[1]?.acknowledgement).toBe("proven-not-applied");
    expect(result.failure).not.toBe(null);
    expect(calls).toEqual(["BEGIN", "COMMIT", "ROLLBACK"]);
    expect(database.query("SELECT * FROM child").all()).toEqual([]);
    const recovered = await protocol.begin(async (tx) => {
      await tx.execute({ text: "INSERT INTO parent VALUES(42)", params: [] });
      await tx.execute({ text: "INSERT INTO child VALUES(42)", params: [] });
      return commit(1);
    });
    expect(recovered.data).toBe("committed");
    expect(database.query("SELECT * FROM child").all()).toEqual([{ parent_id: 42 }]);
  } finally {
    database.close();
  }
});

function mysqlPinPort(releaseError?: { error: unknown }) {
  const calls: string[] = [];
  const connection: MysqlPoolConnection = {
    async execute() {
      throw new Error("unexpected fake native SQL; protocol test only");
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
      if (releaseError) throw releaseError.error;
    },
    destroy() {
      calls.push("destroy");
    },
  };
  return { connection, calls };
}

test("MySQL pin release is once-only and closes future native admission", async () => {
  const port = mysqlPinPort();
  const pin = createMysqlPin(port.connection);
  const terminal = await pin.begin(async () => commit(1));
  expect(terminal.data).toBe("committed");
  const actualRelease = pin.release();
  expect(await actualRelease).toEqual({ ok: true });
  expect(pin.release()).toBe(actualRelease);
  expect(pin.discard()).toBe(actualRelease);
  await assert.rejects(
    pin.begin(async () => commit(2)),
    /no longer available/,
  );
  expect(port.calls).toEqual(["BEGIN", "COMMIT", "release"]);
});

test("MySQL failed release retains original disposal result and never retries discard", async () => {
  const error = Object.freeze({ opaque: "native release failed" });
  const port = mysqlPinPort({ error });
  const pin = createMysqlPin(port.connection);
  const actual = pin.release();
  const result = await actual;
  expect(result).toEqual({ ok: false, error, ownership: "unknown" });
  expect(pin.release()).toBe(actual);
  expect(pin.discard()).toBe(actual);
  expect(port.calls).toEqual(["release"]);
});

test("MySQL in-flight callback cannot acknowledge disposal or invoke physical release", async () => {
  const port = mysqlPinPort();
  const pin = createMysqlPin(port.connection);
  const entered = gate();
  const release = gate();
  let actual: Promise<unknown> | undefined;
  try {
    actual = pin.begin(async () => {
      entered.resolve();
      await release.promise;
      return commit(3);
    });
    void actual.catch(() => entered.resolve());
    await entered.promise;
    const disposal = pin.release();
    const result = await disposal;
    assert.equal(result.ok, false);
    expect(result.ownership).toBe("retained");
    expect(port.calls).toEqual(["BEGIN"]);
    expect(pin.discard()).toBe(disposal);
    release.resolve();
    expect(await actual).toMatchObject({ data: "committed" });
    // Disposal failure is not silently retried after the pending callback settles.
    expect(pin.release()).toBe(disposal);
    expect(port.calls).toEqual(["BEGIN", "COMMIT"]);
  } finally {
    release.resolve();
    await Promise.allSettled([actual]);
  }
});
