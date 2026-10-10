import { afterEach, expect, test } from "bun:test";
import type { DatabaseConnection } from "@getstrata/core/database/baseRepository";
import {
  bindDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { runInTransaction } from "@getstrata/core/database/transaction";
import { dispatchModelEvent } from "@getstrata/core/events/deferredModelEvents";
import { eventBus } from "@getstrata/core/events/eventBus";

afterEach(() => resetBoundDatabaseConnection());
function fixture(
  controller = new AbortController(),
  abortOnReserve = false,
  missingBegin = false,
  abortOnBegin = false,
) {
  const calls: string[] = [];
  const tx: DatabaseConnection = {
    async unsafe<T>(query: string) {
      calls.push(query);
      return [] as T[];
    },
  };
  const reserved = {
    ...tx,
    async begin<T>(run: (connection: DatabaseConnection) => Promise<T>) {
      calls.push("begin");
      try {
        if (abortOnBegin) controller.abort(new Error("cancelled before callback"));
        const value = await run(tx);
        calls.push("commit");
        return value;
      } catch (error) {
        calls.push("rollback");
        throw error;
      }
    },
    release() {
      calls.push("release");
    },
  };
  bindDatabaseConnection({
    ...tx,
    begin: reserved.begin,
    async reserve(options) {
      expect(options.signal).toBe(controller.signal);
      calls.push("reserve");
      if (abortOnReserve) controller.abort(new Error("cancelled after reservation"));
      return missingBegin ? { ...tx, release: reserved.release } : reserved;
    },
  });
  return { calls, controller };
}

test("pre-aborted acquisition performs no reservation or transaction", async () => {
  const { calls, controller } = fixture();
  const reason = new Error("cancelled before admission");
  controller.abort(reason);
  await expect(
    runInTransaction(async () => {}, { acquisitionSignal: controller.signal }),
  ).rejects.toBe(reason);
  expect(calls).toEqual([]);
});

test("unsupported adapters fail explicitly without emulating a cancellable wait", async () => {
  const { calls } = fixture();
  bindDatabaseConnection({
    async unsafe() {
      return [];
    },
    async begin(run) {
      calls.push("unsupported begin");
      return run(this);
    },
  });
  await expect(
    runInTransaction(async () => {}, { acquisitionSignal: new AbortController().signal }),
  ).rejects.toThrow("cancellable transaction acquisition");
  expect(calls).toEqual([]);
});

test("a reservation acquired just as cancellation arrives is released", async () => {
  const { calls, controller } = fixture(new AbortController(), true);
  await expect(
    runInTransaction(async () => {}, { acquisitionSignal: controller.signal }),
  ).rejects.toThrow("cancelled after reservation");
  expect(calls).toEqual(["reserve", "release"]);
});

test("malformed reserved adapters are released before rejecting", async () => {
  const { calls, controller } = fixture(new AbortController(), false, true);
  await expect(
    runInTransaction(async () => {}, { acquisitionSignal: controller.signal }),
  ).rejects.toThrow("Reserved database connection");
  expect(calls).toEqual(["reserve", "release"]);
});

test("cancellation during BEGIN rolls back without running business code", async () => {
  const { calls, controller } = fixture(new AbortController(), false, false, true);
  let called = false;
  await expect(
    runInTransaction(
      async () => {
        called = true;
      },
      { acquisitionSignal: controller.signal },
    ),
  ).rejects.toThrow("cancelled before callback");
  expect(called).toBe(false);
  expect(calls).toEqual(["reserve", "begin", "rollback", "release"]);
});

test("aborting after callback admission does not cancel business work; nested calls use savepoints", async () => {
  const { calls, controller } = fixture();
  const result = await runInTransaction(
    async (tx) => {
      controller.abort();
      await tx.unsafe("outer write");
      await runInTransaction(async (nested) => nested.unsafe("nested write"), {
        acquisitionSignal: new AbortController().signal,
      });
      return 42;
    },
    { acquisitionSignal: controller.signal },
  );
  expect(result).toBe(42);
  expect(calls.filter((call) => call === "reserve")).toHaveLength(1);
  expect(calls.some((call) => call.startsWith("SAVEPOINT "))).toBe(true);
  expect(calls.slice(-2)).toEqual(["commit", "release"]);
});

test("callback failure rolls back and releases the reservation", async () => {
  const { calls, controller } = fixture();
  await expect(
    runInTransaction(
      async () => {
        throw new Error("business failure");
      },
      { acquisitionSignal: controller.signal },
    ),
  ).rejects.toThrow("business failure");
  expect(calls).toEqual(["reserve", "begin", "rollback", "release"]);
});

test("release precedes deferred observers so a single-slot pool can be reused", async () => {
  const { calls, controller } = fixture();
  const name = `acquisition.${crypto.randomUUID()}`;
  const unsubscribe = eventBus.on(name, async () => {
    expect(calls.at(-1)).toBe("release");
    await runInTransaction(async (tx) => tx.unsafe("observer read"));
  });
  try {
    await runInTransaction(async () => dispatchModelEvent(name, {}), {
      acquisitionSignal: controller.signal,
    });
    expect(calls).toContain("observer read");
  } finally {
    unsubscribe();
  }
});
