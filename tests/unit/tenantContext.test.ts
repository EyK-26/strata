import { describe, expect, test } from "bun:test";
import {
  currentTenant,
  currentTenantId,
  rateLimitMultiplierForPlan,
  runWithTenant,
} from "@getstrata/core/tenant/tenantContext";

describe("tenantContext", () => {
  test("returns default tenant id outside tenant scope", () => {
    expect(currentTenant()).toBeNull();
    expect(currentTenantId()).toBe(1);
  });

  test("runs callbacks within tenant scope", () => {
    const tenant = { id: 9, slug: "acme", plan: "pro" as const, region: "us" as const };

    runWithTenant(tenant, () => {
      expect(currentTenant()).toEqual(tenant);
      expect(currentTenantId()).toBe(9);
    });

    expect(currentTenant()).toBeNull();
  });

  test("maps tenant plans to rate limit multipliers", () => {
    expect(rateLimitMultiplierForPlan("free")).toBe(1);
    expect(rateLimitMultiplierForPlan("pro")).toBe(2);
    expect(rateLimitMultiplierForPlan("enterprise")).toBe(4);
  });
});
