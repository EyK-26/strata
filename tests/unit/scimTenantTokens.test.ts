import { describe, expect, test } from "bun:test";
import {
  parseScimTenantTokens,
  resolveScimTenantFromToken,
} from "../../src/core/security/scimTenantTokens";
import { TEST_SCIM_BEARER_TOKEN } from "../../src/domain/scim";

describe("scimTenantTokens", () => {
  test("parses tenant token map", () => {
    const tokens = parseScimTenantTokens("1:token-a,2:token-b");
    expect(tokens.get(1)).toBe("token-a");
    expect(tokens.get(2)).toBe("token-b");
  });

  test("resolves tenant from SCIM_TENANT_TOKENS", () => {
    process.env.SCIM_TENANT_TOKENS = "2:tenant-two-token";
    expect(resolveScimTenantFromToken("tenant-two-token")).toBe(2);
    delete process.env.SCIM_TENANT_TOKENS;
  });

  test("falls back to default tenant for global SCIM token", () => {
    process.env.SCIM_BEARER_TOKEN = TEST_SCIM_BEARER_TOKEN;
    expect(resolveScimTenantFromToken(TEST_SCIM_BEARER_TOKEN)).toBe(1);
  });
});
