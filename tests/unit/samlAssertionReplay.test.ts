import { describe, expect, test } from "bun:test";
import {
  createSqlSamlAssertionReplayStore,
  InMemorySamlAssertionReplayStore,
  REPLAY_RETENTION_MS,
} from "@getstrata/core/auth/saml/samlServiceProvider";
import { PersistenceError } from "@getstrata/core/database/errors";
import { withPolicyPersistence } from "../helpers/policyPersistence";

function fakePool(calls: string[], uniqueOn = "") {
  const seen = new Set<string>();
  const pool = Object.assign(async () => [] as unknown[], {
    async begin<T>(callback: (tx: typeof pool) => Promise<T>) {
      return await callback(pool);
    },
    async close() {},
    async unsafe<T>(query: string, params?: readonly unknown[]) {
      calls.push(`${query} ${JSON.stringify(params ?? [])}`);
      const assertionId = String(params?.[0] ?? "");
      if (query.includes("INSERT INTO auth_saml_assertions") && seen.has(assertionId)) {
        throw Object.assign(new Error("duplicate"), { code: "23505" });
      }
      if (query.includes("INSERT INTO auth_saml_assertions")) {
        seen.add(assertionId);
        if (uniqueOn && assertionId === uniqueOn) {
          throw Object.assign(new Error("duplicate"), { code: "23505" });
        }
      }
      return [] as T[];
    },
  });
  return pool;
}

// SQL-shape fault fixture uses genuine canonical selection with explicitly synthetic native ACKs.
describe("selected SQL SAML replay store", () => {
  test("formats both stored and retention cutoff timestamps for MySQL", async () => {
    const calls: string[] = [];
    await withPolicyPersistence(
      fakePool(calls),
      async ({ database }) => {
        const store = createSqlSamlAssertionReplayStore(database);
        await store.consume("mysql-timestamp");
        expect(calls).toHaveLength(2);
        for (const call of calls) {
          expect(call).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
          expect(call).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
          expect(call).toContain("?");
        }
      },
      { driver: "mysql" },
    );
  });
  test("inserts consumed_at and garbage-collects stale rows after a live insert", async () => {
    const calls: string[] = [];
    await withPolicyPersistence(fakePool(calls), async ({ database }) => {
      const store = createSqlSamlAssertionReplayStore(database);
      await store.consume("assert-live");
      expect(calls[0]).toContain("INSERT INTO auth_saml_assertions");
      expect(calls[0]).toContain("consumed_at");
      expect(calls[1]).toContain("DELETE FROM auth_saml_assertions");
      expect(calls[1]).toContain("consumed_at <");
    });
  });

  test("treats a unique constraint as replay", async () => {
    const calls: string[] = [];
    await withPolicyPersistence(fakePool(calls, "assert-dup"), async ({ database }) => {
      await expect(
        createSqlSamlAssertionReplayStore(database).consume("assert-dup"),
      ).rejects.toThrow("replay");
      expect(calls.some((line) => line.includes("DELETE"))).toBe(false);
    });
  });

  test("in-memory store still detects replay after a typical NotOnOrAfter window", async () => {
    const store = new InMemorySamlAssertionReplayStore();
    const now = Date.now();
    const originalNow = Date.now;
    Date.now = () => now;
    try {
      await store.consume("assert-ttl");
      Date.now = () => now + 11 * 60 * 1000;
      await expect(store.consume("assert-ttl")).rejects.toThrow("replay");
    } finally {
      Date.now = originalNow;
    }
  });

  test("in-memory store expires the id after the same retention as SQL", async () => {
    const store = new InMemorySamlAssertionReplayStore();
    const now = Date.now();
    const originalNow = Date.now;
    Date.now = () => now;
    try {
      expect(REPLAY_RETENTION_MS).toBe(60 * 60 * 1000);
      await store.consume("assert-gc");
      Date.now = () => now + REPLAY_RETENTION_MS;
      await store.consume("assert-gc");
      await expect(store.consume("assert-gc")).rejects.toThrow("replay");
    } finally {
      Date.now = originalNow;
    }
  });
});

test("expired replay entries are evicted while current duplicates still fail closed", async () => {
  const original = Date.now;
  let now = original();
  Date.now = () => now;
  const store = new InMemorySamlAssertionReplayStore();
  try {
    await store.consume("expired");
    await expect(store.consume("expired")).rejects.toThrow("replay");
    now += REPLAY_RETENTION_MS + 1;
    await store.consume("current");
    await expect(store.consume("expired")).resolves.toBeUndefined();
    await expect(store.consume("current")).rejects.toThrow("replay");
  } finally {
    Date.now = original;
  }
});

test("replay-store infrastructure failures retain their original error", async () => {
  const failure = new Error("replay database unavailable");
  const pool = fakePool([]);
  pool.unsafe = async () => {
    throw failure;
  };
  const error = await withPolicyPersistence(pool, async ({ database }) => {
    await createSqlSamlAssertionReplayStore(database).consume("must-not-authorize");
  }).then(
    () => {
      throw new Error("Expected infrastructure failure");
    },
    (error) => error,
  );
  expect(error).toBeInstanceOf(PersistenceError);
  expect(error.code).toBe("DATABASE_OPERATION_FAILED");
  expect(error.cause).toBe(failure);
});

test("explicit in-memory replay clear reopens only its own consumed IDs once", async () => {
  const first = new InMemorySamlAssertionReplayStore();
  const second = new InMemorySamlAssertionReplayStore();
  const untouched = new InMemorySamlAssertionReplayStore();
  await first.consume("shared");
  await second.consume("shared");
  untouched.clear();
  await expect(first.consume("shared")).rejects.toThrow("replay");
  await expect(second.consume("shared")).rejects.toThrow("replay");
  first.clear();
  await first.consume("shared");
  await expect(first.consume("shared")).rejects.toThrow("replay");
  await expect(second.consume("shared")).rejects.toThrow("replay");
});
