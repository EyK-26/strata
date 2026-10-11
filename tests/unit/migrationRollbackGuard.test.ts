import { describe, expect, test } from "bun:test";
import { guardMigrationRollback } from "../../src/core/database/migrations/rollbackGuard.ts";

describe("optional migration rollback guards", () => {
  test("ordinary rollback checks synchronous and asynchronous history", async () => {
    for (const hasHistory of [() => true, async () => true]) {
      await expect(
        guardMigrationRollback(undefined, { hasHistory, message: "Retain audit history" }),
      ).rejects.toThrow("Retain audit history");
    }
    for (const hasHistory of [() => false, async () => false]) {
      await guardMigrationRollback(undefined, { hasHistory, message: "Retain audit history" });
    }
  });
  test("fresh skips the predicate entirely", async () => {
    await guardMigrationRollback(
      { operation: "fresh" },
      {
        hasHistory() {
          throw new Error("History query must not run");
        },
        message: "Retain audit history",
      },
    );
  });
  test("read failures propagate before destructive effects", async () => {
    const failure = new Error("History lookup unavailable");
    let dropped = false;
    async function down() {
      await guardMigrationRollback(undefined, {
        hasHistory: async () => {
          throw failure;
        },
        message: "Retain audit history",
      });
      dropped = true;
    }
    await expect(down()).rejects.toBe(failure);
    expect(dropped).toBe(false);
    await expect(
      guardMigrationRollback(undefined, {
        hasHistory() {
          throw failure;
        },
        message: "Retain audit history",
      }),
    ).rejects.toBe(failure);
  });
  test("concurrent calls keep their own predicate and refusal", async () => {
    const results = await Promise.allSettled([
      guardMigrationRollback(undefined, {
        hasHistory: async () => true,
        message: "Tenant A history",
      }),
      guardMigrationRollback(undefined, {
        hasHistory: async () => false,
        message: "Tenant B history",
      }),
      guardMigrationRollback(
        { operation: "fresh" },
        { hasHistory: () => true, message: "Reset history" },
      ),
    ]);
    expect(results[0]?.status).toBe("rejected");
    if (results[0]?.status === "rejected")
      expect(results[0].reason.message).toBe("Tenant A history");
    expect(results.slice(1).map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
  });
});
