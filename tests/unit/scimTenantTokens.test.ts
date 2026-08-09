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
    process.env.SCIM_TENANT_TOKENS = "2:tenant-two-token,3:tenant-three-token";
    expect(resolveScimTenantFromToken("tenant-two-token")).toBe(2);
    expect(resolveScimTenantFromToken("tenant-three-token")).toBe(3);
    delete process.env.SCIM_TENANT_TOKENS;
  });

  test("falls back to default tenant for global SCIM token", () => {
    process.env.SCIM_BEARER_TOKEN = TEST_SCIM_BEARER_TOKEN;
    expect(resolveScimTenantFromToken(TEST_SCIM_BEARER_TOKEN)).toBe(1);
  });

  test("ignores malformed tenant token entries and unknown tokens", () => {
    expect(parseScimTenantTokens("bad-entry,2:valid-token")).toEqual(new Map([[2, "valid-token"]]));
    expect(parseScimTenantTokens("")).toEqual(new Map());
    expect(parseScimTenantTokens("   ")).toEqual(new Map());
    expect(resolveScimTenantFromToken("unknown-token")).toBeNull();
  });
});
