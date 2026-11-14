import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { createTransactionAcquisitionMetrics } from "../../src/core/database/acquisitionMetrics";
import {
  createRawPostgresPoolFromNative,
  type PostgresNativePool,
  type PostgresNativeReserved,
  type PostgresNativeRows,
} from "../../src/core/database/rawPostgres";

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
type Exchange = { sql: string; params?: unknown[]; command?: string; rows?: unknown[] };
function scriptedPostgres(
  exchanges: readonly Exchange[],
  options: {
    reserveFailure?: { error: unknown };
    release?: () => Promise<void>;
    close?: () => Promise<void>;
    poolClose?: () => Promise<void>;
  } = {},
) {
  const pending = [...exchanges];
  const calls: string[] = [];
  const reserves: Array<{ signal?: AbortSignal } | undefined> = [];
  const unsafe = async (sql: string, params: unknown[]): Promise<PostgresNativeRows> => {
    calls.push(sql);
    const expected = pending.shift();
    assert.ok(expected, `unexpected native exchange ${sql}`);
    assert.equal(sql, expected.sql);
    assert.deepEqual(params, expected.params ?? []);
    return Object.assign(expected.rows ?? [], { command: expected.command });
  };
  const reserved: PostgresNativeReserved = {
    unsafe,
    async release() {
      calls.push("release");
      await options.release?.();
    },
    async close(closeOptions) {
      assert.deepEqual(closeOptions, { timeout: 0 });
      calls.push("reserved.close");
      await options.close?.();
    },
  };
  const native: PostgresNativePool = {
    unsafe,
    async reserve(reserveOptions) {
      calls.push("reserve");
      reserves.push(reserveOptions);
      if (options.reserveFailure) throw options.reserveFailure.error;
      return reserved;
    },
    async close() {
      calls.push("pool.close");
      await options.poolClose?.();
    },
  };
  return {
    pool: createRawPostgresPoolFromNative(native),
    calls,
    reserves,
    done: () => assert.deepEqual(pending, []),
  };
}

test("PostgreSQL close immediately stops admission and shares its native cleanup acknowledgement", async () => {
  for (const failure of [null, Object.freeze({ close: "opaque cleanup failure" })]) {
    const finish = gate();
    const fixture = scriptedPostgres([], {
      poolClose: async () => {
        await finish.promise;
        if (failure) throw failure;
      },
    });
    const closing = Promise.resolve(fixture.pool.close());
    void closing.catch(() => {});
    try {
      const acquired = await fixture.pool.checkout();
      assert.equal(acquired.ok, false);
      assert.equal(acquired.disposition, "not-acquired");
      assert.match(String(acquired.error), /pool is closed/);
      await assert.rejects(
        fixture.pool.execute({ text: "SELECT forbidden", params: [] }),
        /pool is closed/,
      );
      assert.strictEqual(fixture.pool.close(), closing);
      finish.resolve();
      if (failure) await assert.rejects(closing, (error) => error === failure);
      else await closing;
      assert.strictEqual(fixture.pool.close(), closing);
      const afterClose = await fixture.pool.checkout();
      assert.equal(afterClose.ok, false);
      assert.match(String(afterClose.error), /pool is closed/);
      assert.deepEqual(fixture.calls, ["pool.close"]);
      fixture.done();
    } finally {
      finish.resolve();
      await Promise.allSettled([closing]);
    }
  }
});

test("PostgreSQL native boundary requires an actual BEGIN command acknowledgement", async () => {
  for (const command of [undefined, "COMMIT"]) {
    const fixture = scriptedPostgres([{ sql: "BEGIN", command }]);
    try {
      const opened = await fixture.pool.checkout();
      assert.equal(opened.ok, true);
      let entered = false;
      const terminal = await opened.value.begin(async () => {
        entered = true;
        return { finish: "commit", result: 1 };
      });
      expect(entered).toBe(false);
      expect(terminal.data).toBe("unknown");
      expect(terminal.stage.kind).toBe("callback-not-entered");
      expect(terminal.failure?.error).toBeInstanceOf(Error);
      expect(terminal.phases[0]?.acknowledgement).toBe("unknown");
      expect(await opened.value.discard()).toEqual({ ok: true });
      expect(fixture.calls).toEqual(["reserve", "BEGIN", "reserved.close"]);
      fixture.done();
    } finally {
      await fixture.pool.close();
    }
  }
});

test("PostgreSQL missing COMMIT acknowledgement stays unknown after observed ROLLBACK command", async () => {
  const fixture = scriptedPostgres([
    { sql: "BEGIN", command: "BEGIN" },
    { sql: "COMMIT" },
    { sql: "ROLLBACK", command: "ROLLBACK" },
  ]);
  try {
    const opened = await fixture.pool.checkout();
    assert.equal(opened.ok, true);
    const terminal = await opened.value.begin(async () => ({ finish: "commit", result: false }));
    assert.equal(terminal.data, "unknown");
    expect(terminal.nativeState).toBe("idle");
    expect(terminal.stage).toEqual({
      kind: "decided",
      decision: { finish: "commit", result: false },
    });
    expect(terminal.phases.map((phase) => phase.acknowledgement)).toEqual([
      "confirmed-reply",
      "unknown",
      "confirmed-reply",
    ]);
    expect(await opened.value.release()).toEqual({ ok: true });
    fixture.done();
  } finally {
    await fixture.pool.close();
  }
});

test("PostgreSQL native adapter forwards signal, records actual checkout metrics and validates savepoint ACKs", async () => {
  const fixture = scriptedPostgres([
    { sql: "SELECT explicit_parameter", params: [7], rows: [{ value: 7 }] },
    { sql: "BEGIN", command: "BEGIN" },
    { sql: "SAVEPOINT strata_sp_1", command: "SAVEPOINT" },
    { sql: "SELECT child_parameter", params: [8], rows: [{ value: 8 }] },
    { sql: "ROLLBACK TO SAVEPOINT strata_sp_1", command: "ROLLBACK" },
    { sql: "RELEASE SAVEPOINT strata_sp_1", command: "RELEASE" },
    { sql: "COMMIT", command: "ROLLBACK" },
  ]);
  const metrics = createTransactionAcquisitionMetrics();
  const signal = new AbortController().signal;
  try {
    expect(await fixture.pool.execute({ text: "SELECT explicit_parameter", params: [7] })).toEqual(
      Object.assign([{ value: 7 }], { command: undefined }),
    );
    const opened = await fixture.pool.checkout({ signal, metrics });
    assert.equal(opened.ok, true);
    expect(fixture.reserves).toEqual([{ signal }]);
    const terminal = await opened.value.begin(async (tx) => {
      const child = await tx.savepoint(async (nested) => {
        expect(await nested.execute({ text: "SELECT child_parameter", params: [8] })).toEqual(
          Object.assign([{ value: 8 }], { command: undefined }),
        );
        return { finish: "rollback", result: 0 };
      });
      expect(child.data).toBe("rolled-back");
      return { finish: "commit", result: 9 };
    });
    assert.equal(
      terminal.data,
      "rolled-back",
      "PostgreSQL COMMIT replying ROLLBACK is not committed data",
    );
    expect(terminal.stage).toEqual({ kind: "decided", decision: { finish: "commit", result: 9 } });
    expect(await opened.value.release()).toEqual({ ok: true });
    expect(metrics.snapshot().inflight).toBe(0);
    expect(metrics.snapshot().outcomes.find((value) => value.outcome === "acquired")?.count).toBe(
      1,
    );
    fixture.done();
  } finally {
    await fixture.pool.close();
  }
});

test("PostgreSQL failed reserve preserves opaque cause, records aborted checkout and closes admission", async () => {
  const error = Object.freeze({ reserve: "opaque" });
  const fixture = scriptedPostgres([], { reserveFailure: { error } });
  const controller = new AbortController();
  controller.abort();
  const metrics = createTransactionAcquisitionMetrics();
  const outcome = await fixture.pool.checkout({ signal: controller.signal, metrics });
  assert.equal(outcome.ok, false);
  expect(outcome.error).toBe(error);
  expect(outcome.disposition).toBe("not-acquired");
  expect(metrics.snapshot().inflight).toBe(0);
  expect(metrics.snapshot().outcomes.find((value) => value.outcome === "aborted")?.count).toBe(1);
  await fixture.pool.close();
  const afterClose = await fixture.pool.checkout();
  assert.equal(afterClose.ok, false);
  expect(afterClose.disposition).toBe("not-acquired");
  await assert.rejects(
    fixture.pool.execute({ text: "SELECT forbidden", params: [] }),
    /pool is closed/,
  );
  expect(fixture.calls).toEqual(["reserve", "pool.close"]);
  fixture.done();
});

test("PostgreSQL release awaits actual acknowledgement and never falls back to close after failure", async () => {
  for (const failure of [null, Object.freeze({ release: "opaque" })]) {
    const entered = gate();
    const release = gate();
    const fixture = scriptedPostgres([], {
      release: async () => {
        entered.resolve();
        await release.promise;
        if (failure) throw failure;
      },
    });
    const opened = await fixture.pool.checkout();
    assert.equal(opened.ok, true);
    const disposal = opened.value.release();
    let settled = false;
    const observation = disposal.then((value) => {
      settled = true;
      return value;
    });
    try {
      void observation.then(() => entered.resolve());
      await entered.promise;
      await eventLoopTurn();
      expect(settled).toBe(false);
      expect(opened.value.release()).toBe(disposal);
      expect(opened.value.discard()).toBe(disposal);
      release.resolve();
      expect(await observation).toEqual(
        failure ? { ok: false, error: failure, ownership: "unknown" } : { ok: true },
      );
      expect(fixture.calls).toEqual(["reserve", "release"]);
      await assert.rejects(
        opened.value.begin(async () => ({ finish: "commit", result: 0 })),
        /no longer available/,
      );
      fixture.done();
    } finally {
      release.resolve();
      await Promise.allSettled([disposal, observation]);
      await fixture.pool.close();
    }
  }
});

test("PostgreSQL discard requires awaited native close and preserves unknown close failure without retry", async () => {
  for (const failure of [null, Object.freeze({ close: "opaque" })]) {
    const entered = gate();
    const release = gate();
    const fixture = scriptedPostgres([], {
      close: async () => {
        entered.resolve();
        await release.promise;
        if (failure) throw failure;
      },
    });
    const opened = await fixture.pool.checkout();
    assert.equal(opened.ok, true);
    const actual = opened.value.discard();
    let settled = false;
    const observation = actual.then((value) => {
      settled = true;
      return value;
    });
    try {
      void observation.then(() => entered.resolve());
      await entered.promise;
      await eventLoopTurn();
      expect(settled).toBe(false);
      expect(opened.value.release()).toBe(actual);
      release.resolve();
      expect(await observation).toEqual(
        failure ? { ok: false, error: failure, ownership: "unknown" } : { ok: true },
      );
      expect(opened.value.discard()).toBe(actual);
      expect(fixture.calls).toEqual(["reserve", "reserved.close"]);
      fixture.done();
    } finally {
      release.resolve();
      await Promise.allSettled([actual, observation]);
      await fixture.pool.close();
    }
  }
});

test("PostgreSQL running native transaction cannot acknowledge physical disposal", async () => {
  const fixture = scriptedPostgres([
    { sql: "BEGIN", command: "BEGIN" },
    { sql: "COMMIT", command: "COMMIT" },
  ]);
  const entered = gate();
  const release = gate();
  let actual: Promise<unknown> | undefined;
  try {
    const opened = await fixture.pool.checkout();
    assert.equal(opened.ok, true);
    actual = opened.value.begin(async () => {
      entered.resolve();
      await release.promise;
      return { finish: "commit", result: 19 };
    });
    void actual.then(
      () => entered.resolve(),
      () => entered.resolve(),
    );
    await entered.promise;
    const disposal = opened.value.release();
    const outcome = await disposal;
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ownership, "retained");
    assert.strictEqual(opened.value.discard(), disposal);
    assert.deepEqual(fixture.calls, ["reserve", "BEGIN"]);
    release.resolve();
    expect(await actual).toMatchObject({
      data: "committed",
      stage: { kind: "decided", decision: { finish: "commit", result: 19 } },
    });
    assert.strictEqual(opened.value.release(), disposal);
    assert.deepEqual(fixture.calls, ["reserve", "BEGIN", "COMMIT"]);
    fixture.done();
  } finally {
    release.resolve();
    await Promise.allSettled([actual]);
    await fixture.pool.close();
  }
});
