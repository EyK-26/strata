import { describe, expect, test } from "bun:test";
import { isTenancyEnabled, readTenancyDriver } from "../../src/core/tenant/tenancyConfig";

describe("tenancyConfig", () => {
  test("defaults to the postgres RLS adapter", () => {
    expect(readTenancyDriver({})).toBe("rls");
    expect(isTenancyEnabled({})).toBe(true);
  });

  test("can disable tenancy for apps without a tenant table", () => {
    expect(readTenancyDriver({ TENANCY_DRIVER: "none" })).toBe("none");
    expect(isTenancyEnabled({ TENANCY_DRIVER: "none" })).toBe(false);
  });
});
