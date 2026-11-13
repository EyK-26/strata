import { describe, expect, test } from "bun:test";
import { currentTenant, currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import { withPolicyPersistence } from "../helpers/policyPersistence";

const tenant = { id: 1, slug: "acme" };
describe("runWithTenantDatabase", () => {
  test("sets callback tenant context and restores it after nested selected scopes", async () => {
    const statements: Array<{ text: string; params: readonly unknown[] }> = [];
    await withPolicyPersistence(
      {
        async unsafe<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
          statements.push({ text, params });
          return [];
        },
      },
      async ({ database, policy }) => {
        await runWithTenantDatabase(database, policy, tenant, async (child) => {
          expect(currentTenant()).toEqual(tenant);
          expect(currentTenantId()).toBe(1);
          await runWithTenantDatabase(child, policy, tenant, async (nested) => {
            expect(nested).not.toBe(child);
            expect(currentTenantId()).toBe(1);
            await nested.execute({ text: "SELECT nested_work", params: [] });
          });
          expect(currentTenant()).toEqual(tenant);
        });
        expect(currentTenant()).toBeNull();
      },
      { envelope: { kind: "command", tenant } },
    );
    expect(
      statements.filter((row) =>
        row.text.includes(
          "set_config('app.tenant_id', $1, true), set_config('app.bypass_rls', $2, true)",
        ),
      ),
    ).toHaveLength(2);
    expect(
      statements.filter((row) => row.params[0] === "1" && row.params[1] === "false"),
    ).toHaveLength(2);
    expect(currentTenant()).toBeNull();
  });
  test("refuses an unestablished or different tenant before invoking the callback", async () => {
    let calls = 0;
    await withPolicyPersistence(
      {
        async unsafe() {
          calls++;
          return [];
        },
      },
      async ({ database, policy }) => {
        expect(() =>
          runWithTenantDatabase(database, policy, { id: 2, slug: "other" }, async () => {
            calls++;
          }),
        ).toThrow("Established tenant identity mismatch");
      },
      { envelope: { kind: "command", tenant } },
    );
    expect(calls).toBe(0);
  });
  for (const driver of ["sqlite", "mysql"] as const)
    test(`requires PostgreSQL for explicit RLS on ${driver}`, async () => {
      let queries = 0;
      await withPolicyPersistence(
        {
          async unsafe() {
            queries++;
            return [];
          },
        },
        async ({ database, policy }) => {
          expect(() => runWithTenantDatabase(database, policy, tenant, async () => "nope")).toThrow(
            /requires PostgreSQL/,
          );
        },
        { driver, envelope: { kind: "command", tenant } },
      );
      expect(queries).toBe(0);
    });
});
