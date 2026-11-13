import { describe, expect, test } from "bun:test";
import {
  runWithMigrationBypass,
  runWithMigrationBypassForIdentifier,
} from "@getstrata/core/tenant/databaseTenantContext";
import type { SqlFixture } from "../helpers/boundRepositoryHarness";
import { withPolicyPersistence } from "../helpers/policyPersistence";

function sqlFixture(
  calls: Array<{ text: string; params: readonly unknown[] }>,
  previous = { tenant_id: "7", bypass_rls: "false", bypass_identifier: "old" },
): SqlFixture {
  return {
    async unsafe<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      calls.push({ text, params });
      return (text.includes("current_setting") ? [previous] : []) as T[];
    },
  };
}
describe("explicit PostgreSQL policy helpers", () => {
  // Non-RLS applications use their selected session directly. These explicit RLS
  // capabilities refuse unsupported drivers instead of consulting process.env.
  for (const driver of ["sqlite", "mysql"] as const)
    test(`refuses ${driver} before policy SQL`, async () => {
      const calls: Array<{ text: string; params: readonly unknown[] }> = [];
      await withPolicyPersistence(
        sqlFixture(calls),
        async ({ database, policy }) => {
          expect(() => runWithMigrationBypass(database, policy, async () => "nope")).toThrow(
            /requires PostgreSQL/,
          );
          expect(() =>
            runWithMigrationBypassForIdentifier(
              database,
              policy,
              "user@example.test",
              async () => "nope",
            ),
          ).toThrow(/requires PostgreSQL/);
        },
        { driver },
      );
      expect(calls).toEqual([]);
    });
  test("bypass sets a local flag and restores every prior setting before completion", async () => {
    const calls: Array<{ text: string; params: readonly unknown[] }> = [];
    await withPolicyPersistence(sqlFixture(calls), async ({ database, policy }) => {
      expect(
        await runWithMigrationBypass(database, policy, async (child) => {
          expect(child).not.toBe(database);
          await child.execute({ text: "SELECT 1", params: [] });
          return "ok";
        }),
      ).toBe("ok");
    });
    expect(calls[0]?.text).toContain("current_setting");
    expect(calls[1]).toEqual({
      text: "SELECT set_config('app.bypass_rls', $1, true)",
      params: ["true"],
    });
    expect(calls[2]?.text).toBe("SELECT 1");
    expect(calls.at(-1)?.params).toEqual(["7", "false", "old"]);
  });
  test("nested identifier scope uses the selected child and restores the outer domain", async () => {
    const calls: Array<{ text: string; params: readonly unknown[] }> = [];
    await withPolicyPersistence(sqlFixture(calls), ({ database, policy }) =>
      database.transaction(async (outer) => {
        const result = await runWithMigrationBypassForIdentifier(
          outer,
          policy,
          "  user@example.test  ",
          async (child) => {
            expect(child).not.toBe(outer);
            await child.execute({ text: "SELECT child_work", params: [] });
            return "nested";
          },
        );
        expect(result).toBe("nested");
        await outer.execute({ text: "SELECT outer_work", params: [] });
      }),
    );
    expect(calls[1]).toEqual({
      text: "SELECT set_config('app.bypass_identifier', $1, true)",
      params: ["user@example.test"],
    });
    expect(calls.filter((call) => call.params.includes("true"))).toEqual([]);
    expect(calls.at(-2)?.params).toEqual(["7", "false", "old"]);
    expect(calls.at(-1)?.text).toBe("SELECT outer_work");
  });
  test("empty and non-positive identifiers fail before any database effect", async () => {
    const calls: Array<{ text: string; params: readonly unknown[] }> = [];
    await withPolicyPersistence(sqlFixture(calls), async ({ database, policy }) => {
      for (const id of ["", "   ", 0, -3, Number.NaN, 1.5])
        expect(() =>
          runWithMigrationBypassForIdentifier(database, policy, id, async () => "nope"),
        ).toThrow(/caller-supplied identifier/);
      expect(calls).toEqual([]);
      expect(await runWithMigrationBypassForIdentifier(database, policy, 1, async () => "ok")).toBe(
        "ok",
      );
      expect(calls[1]?.params).toEqual(["1"]);
    });
  });
  test("callback failure remains a rollback failure instead of a successful restoration", async () => {
    const calls: Array<{ text: string; params: readonly unknown[] }> = [];
    await withPolicyPersistence(sqlFixture(calls), async ({ database, policy }) => {
      await expect(
        runWithMigrationBypass(database, policy, async () => {
          throw new Error("operation failed");
        }),
      ).rejects.toThrow("operation failed");
    });
    expect(calls).toHaveLength(2);
  });
});
