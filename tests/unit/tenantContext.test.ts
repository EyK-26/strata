import { describe, expect, test } from "bun:test";
import {
  currentTenant,
  currentTenantId,
  runWithTenant,
} from "@getstrata/core/tenant/tenantContext";

describe("tenantContext", () => {
  test("refuses to invent a tenant id outside tenant scope", () => {
    expect(currentTenant()).toBeNull();
    expect(() => currentTenantId()).toThrow("Tenant context is required.");
  });

  test("runs callbacks within tenant scope", () => {
    const tenant = { id: 9, slug: "acme", plan: "pro" as const, region: "us" as const };

    runWithTenant(tenant, () => {
      expect(currentTenant()).toEqual(tenant);
      expect(currentTenantId()).toBe(9);
    });

    expect(currentTenant()).toBeNull();
  });

  test("preserves arbitrary application metadata without interpreting it", () => {
    const tenant = { id: 9, slug: "acme", metadata: { entitlement: "campus", region: "moon" } };
    runWithTenant(tenant, () => expect(currentTenant()?.metadata).toEqual(tenant.metadata));
  });
});
