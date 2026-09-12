import { describe, expect, test } from "bun:test";
import {
  consumeSamlAssertion,
  InMemorySamlAssertionReplayStore,
  resetSamlReplayCacheForTests,
  setSamlAssertionReplayStoreForTests,
} from "@getstrata/core/auth/saml/samlServiceProvider";
import type { SqlDatabaseConnection } from "@getstrata/core/database/baseRepository";
import {
  getDefaultDatabasePool,
  registerDefaultDatabasePool,
  resetDefaultDatabasePoolForTests,
} from "@getstrata/core/database/defaultConnection";
import { getDatabase } from "../../src/db/connection";

function currentPoolOrNull(): SqlDatabaseConnection | null {
  try {
    return getDefaultDatabasePool();
  } catch {
    return null;
  }
}

function restorePool(previous: SqlDatabaseConnection | null): void {
  if (previous) {
    registerDefaultDatabasePool(previous);
    return;
  }
  resetDefaultDatabasePoolForTests();
  if (process.env.DATABASE_URL) {
    getDatabase();
  }
}

function fakePool(calls: string[], uniqueOn = ""): SqlDatabaseConnection {
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
  return pool as SqlDatabaseConnection;
}

describe("SqlSamlAssertionReplayStore", () => {
  test("inserts consumed_at and garbage-collects stale rows after a live insert", async () => {
    const restored = currentPoolOrNull();
    const calls: string[] = [];
    registerDefaultDatabasePool(fakePool(calls));
    setSamlAssertionReplayStoreForTests(null);
    try {
      await consumeSamlAssertion("assert-live");
      expect(calls[0]).toContain("INSERT INTO auth_saml_assertions");
      expect(calls[0]).toContain("consumed_at");
      expect(calls[1]).toContain("DELETE FROM auth_saml_assertions");
      expect(calls[1]).toContain("consumed_at <");
    } finally {
      resetSamlReplayCacheForTests();
      restorePool(restored);
    }
  });

  test("treats a unique constraint as replay", async () => {
    const restored = currentPoolOrNull();
    const calls: string[] = [];
    registerDefaultDatabasePool(fakePool(calls, "assert-dup"));
    setSamlAssertionReplayStoreForTests(null);
    try {
      await expect(consumeSamlAssertion("assert-dup")).rejects.toThrow("replay");
      expect(calls.some((line) => line.includes("DELETE"))).toBe(false);
    } finally {
      resetSamlReplayCacheForTests();
      restorePool(restored);
    }
  });

  test("in-memory store still detects replay after the former TTL window", async () => {
    const store = new InMemorySamlAssertionReplayStore();
    setSamlAssertionReplayStoreForTests(store);
    const now = Date.now();
    const originalNow = Date.now;
    Date.now = () => now;
    try {
      await consumeSamlAssertion("assert-ttl");
      Date.now = () => now + 11 * 60 * 1000;
      await expect(consumeSamlAssertion("assert-ttl")).rejects.toThrow("replay");
    } finally {
      Date.now = originalNow;
      resetSamlReplayCacheForTests();
      restorePool(currentPoolOrNull());
    }
  });
});
