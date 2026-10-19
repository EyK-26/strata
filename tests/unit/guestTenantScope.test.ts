import { expect, test } from "bun:test";
import { type CredentialSource, runWithAuthContext } from "@getstrata/core/auth/authContext";
import {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import { currentTenant } from "@getstrata/core/tenant/tenantContext";
import { createTenantMiddleware } from "@getstrata/core/tenant/tenantMiddleware";
import { restoreEnvVar } from "../helpers/restoreEnv";

async function scenario(
  mode: string,
  flag: string,
  source: CredentialSource,
  hostPolicy?: "approved" | "unknown",
): Promise<{ response: Response; queries: string[]; tenantId: number | null }> {
  const keys = ["APP_ENV", "TENANCY_DRIVER", "TENANT_DEV_HEADERS"] as const;
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const bound = getBoundDatabaseConnection();
  const queries: string[] = [];
  Object.assign(process.env, { APP_ENV: mode, TENANCY_DRIVER: "column", TENANT_DEV_HEADERS: flag });
  bindDatabaseConnection({
    async unsafe<T>(query: string): Promise<T[]> {
      queries.push(query);
      throw new Error("A persisted-account lookup must not silently succeed");
    },
  });
  let tenantId: number | null = null;
  try {
    const middleware = createTenantMiddleware({
      resolveTenant: async (id) => ({ id, slug: `tenant-${id}` }),
      ...(hostPolicy
        ? {
            publicTenancy: {
              resolveTenantId: async (hostname: string) =>
                hostPolicy === "approved" && hostname === "approved.example.test" ? 7 : null,
            },
          }
        : {}),
    });
    const response = await runWithSqlDialect("sqlite", () =>
      runWithAuthContext({ id: 42, role: "admin" }, source, () =>
        middleware(
          new Request("https://approved.example.test/api/notes", {
            headers: { "x-tenant-id": "999", "x-forwarded-host": "untrusted.example.test" },
          }),
          async () => {
            tenantId = currentTenant()?.id ?? null;
            return Response.json({ ok: true });
          },
        ),
      ),
    );
    return { response, queries, tenantId };
  } finally {
    for (const key of keys) restoreEnvVar(key, before[key]);
    if (bound) bindDatabaseConnection(bound);
    else resetBoundDatabaseConnection();
  }
}
for (const [mode, flag, policy, status, tenant] of [
  ["local", "false", undefined, 200, 1],
  ["local", "true", undefined, 200, 999],
  ["local", "TRUE", undefined, 200, 1],
  ["production", "true", undefined, 403, null],
  ["staging", "true", undefined, 403, null],
  ["production", "true", "approved", 200, 7],
  ["staging", "true", "approved", 200, 7],
  ["production", "true", "unknown", 403, null],
] as const)
  test(`guest-source tenancy ${mode}/${flag}/${policy ?? "no-host-policy"} never requires account tables`, async () => {
    const result = await scenario(mode, flag, "guest", policy);
    expect(result.response.status).toBe(status);
    expect(result.tenantId).toBe(tenant);
    expect(result.queries).toEqual([]);
  });
for (const source of ["session", "bearer", "basic", null] as const)
  test(`persisted ${source ?? "legacy"} identity retains membership lookup and fails closed on database failure`, async () => {
    const result = await scenario("local", "false", source);
    expect(result.response.status).toBe(500);
    expect(result.tenantId).toBeNull();
    expect(result.queries.some((query) => query.includes("users"))).toBe(true);
  });
