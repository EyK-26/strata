import { afterEach, describe, expect, test } from "bun:test";
import {
  parseScimTenantTokens,
  resolveScimTenantFromToken,
} from "@getstrata/core/security/scimTenantTokens";
import { TEST_SCIM_BEARER_TOKEN } from "../../src/domain/scim";

const originalTenantTokens = process.env.SCIM_TENANT_TOKENS;
const originalBearerToken = process.env.SCIM_BEARER_TOKEN;

afterEach(() => {
  if (originalTenantTokens === undefined) {
    delete process.env.SCIM_TENANT_TOKENS;
  } else {
    process.env.SCIM_TENANT_TOKENS = originalTenantTokens;
  }

  if (originalBearerToken === undefined) {
    delete process.env.SCIM_BEARER_TOKEN;
  } else {
    process.env.SCIM_BEARER_TOKEN = originalBearerToken;
  }
});

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
  });

  test("falls back to default tenant for global SCIM token", () => {
    delete process.env.SCIM_TENANT_TOKENS;
    process.env.SCIM_BEARER_TOKEN = TEST_SCIM_BEARER_TOKEN;
    expect(resolveScimTenantFromToken(TEST_SCIM_BEARER_TOKEN)).toBe(1);
  });

  test("rejects empty presented tokens and empty fallback secrets", () => {
    delete process.env.SCIM_TENANT_TOKENS;
    delete process.env.SCIM_BEARER_TOKEN;
    expect(resolveScimTenantFromToken("")).toBeNull();
    expect(resolveScimTenantFromToken("   ")).toBeNull();
    process.env.SCIM_BEARER_TOKEN = "";
    expect(resolveScimTenantFromToken("non-empty-presented")).toBeNull();
    process.env.SCIM_BEARER_TOKEN = "   ";
    expect(resolveScimTenantFromToken("non-empty-presented")).toBeNull();
  });

  test("ignores malformed tenant token entries and unknown tokens", () => {
    delete process.env.SCIM_TENANT_TOKENS;
    delete process.env.SCIM_BEARER_TOKEN;
    expect(parseScimTenantTokens("bad-entry,2:valid-token")).toEqual(new Map([[2, "valid-token"]]));
    expect(parseScimTenantTokens("")).toEqual(new Map());
    expect(parseScimTenantTokens("   ")).toEqual(new Map());
    expect(parseScimTenantTokens("0:zero,abc:token,-2:neg")).toEqual(new Map());
    expect(resolveScimTenantFromToken("unknown-token")).toBeNull();
    process.env.SCIM_BEARER_TOKEN = "global-scim-token";
    expect(resolveScimTenantFromToken("unknown-token")).toBeNull();
  });
});
