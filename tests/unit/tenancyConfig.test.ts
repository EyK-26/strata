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
});
