import { timingSafeCompareString } from "./timingSafeCompare";

function parseScimTenantTokens(raw: string | undefined): Map<number, string> {
  const tokens = new Map<number, string>();

  if (!raw?.trim()) {
    return tokens;
  }

  for (const entry of raw.split(",")) {
    const [tenantPart, tokenPart] = entry.split(":");

    if (!tenantPart || !tokenPart) {
      continue;
    }

    const tenantId = Number.parseInt(tenantPart.trim(), 10);
    const token = tokenPart.trim();

    if (Number.isInteger(tenantId) && tenantId > 0 && token.length > 0) {
      tokens.set(tenantId, token);
    }
  }

  return tokens;
}

function resolveScimTenantFromToken(token: string): number | null {
  const presented = token.trim();

  if (presented.length === 0) {
    return null;
  }

  const tenantTokens = parseScimTenantTokens(process.env.SCIM_TENANT_TOKENS);

  for (const [tenantId, expectedToken] of tenantTokens) {
    if (timingSafeCompareString(presented, expectedToken)) {
      return tenantId;
    }
  }

  const fallbackToken = process.env.SCIM_BEARER_TOKEN?.trim() ?? "";

  if (fallbackToken.length === 0) {
    return null;
  }

  if (timingSafeCompareString(presented, fallbackToken)) {
    return 1;
  }

  return null;
}

export { parseScimTenantTokens, resolveScimTenantFromToken };
