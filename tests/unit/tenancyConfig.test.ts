import { describe, expect, test } from "bun:test";
import {
  isRlsTenancy,
  isTenancyEnabled,
  readTenancyDriver,
} from "../../src/core/tenant/tenancyConfig";

describe("tenancyConfig", () => {
  test("defaults to the postgres RLS adapter", () => {
    expect(readTenancyDriver({})).toBe("rls");
    expect(isTenancyEnabled({})).toBe(true);
    expect(isRlsTenancy({})).toBe(true);
  });

  test("can disable tenancy for apps without a tenant table", () => {
    expect(readTenancyDriver({ TENANCY_DRIVER: "none" })).toBe("none");
    expect(isTenancyEnabled({ TENANCY_DRIVER: "none" })).toBe(false);
    expect(isRlsTenancy({ TENANCY_DRIVER: "none" })).toBe(false);
  });

  test("column tenancy is app-scoped without Postgres SET LOCAL", () => {
    expect(readTenancyDriver({ TENANCY_DRIVER: "column" })).toBe("column");
    expect(isTenancyEnabled({ TENANCY_DRIVER: "column" })).toBe(true);
    expect(isRlsTenancy({ TENANCY_DRIVER: "column" })).toBe(false);
  });

  test("rejects unknown drivers instead of silently enabling rls", () => {
    expect(() => readTenancyDriver({ TENANCY_DRIVER: "colum" })).toThrow(
      /TENANCY_DRIVER must be one of rls, column, none; received "colum"/,
    );
    expect(() => isTenancyEnabled({ TENANCY_DRIVER: "off" })).toThrow(/TENANCY_DRIVER/);
    expect(readTenancyDriver({ TENANCY_DRIVER: " rls " })).toBe("rls");
    expect(readTenancyDriver({ TENANCY_DRIVER: "" })).toBe("rls");
  });
});
