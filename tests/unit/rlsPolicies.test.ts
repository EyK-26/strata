import { describe, expect, test } from "bun:test";
import {
  enableTenantRlsSql,
  generatedRlsBootstrapSql,
} from "@getstrata/core/tenant/enableTenantRls";
import db from "../../src/db/connection";

describe("tenant RLS inventory", () => {
  test("forces tenant_isolation on tenant-owned tables including later domain tables", async () => {
    const rows = (await db`
      SELECT tablename
      FROM pg_policies
      WHERE policyname = 'tenant_isolation'
      ORDER BY tablename
    `) as Array<{ tablename: string }>;

    const tables = rows.map((row) => row.tablename);

    expect(tables).toContain("notification");
    expect(tables).toContain("task_attachment");
    expect(tables).toContain("subscription");
    expect(tables).toContain("organization");
    expect(tables).toContain("webhook");
  });

  test("keeps api_token, organization_member, and sessions auth-global without tenant RLS", async () => {
    const rows = (await db`
      SELECT tablename
      FROM pg_policies
      WHERE policyname = 'tenant_isolation'
        AND tablename IN ('api_token', 'organization_member', 'sessions')
    `) as Array<{ tablename: string }>;

    expect(rows).toEqual([]);
  });

  test("generated SQL pins identifier bypass and leaves notes tenant-only", () => {
    const sql = generatedRlsBootstrapSql(
      ["notes", "users"],
      ["auth_one_time_tokens", "sessions", "api_tokens"],
    );
    expect(sql).toContain("app.bypass_identifier");
    expect(sql).toContain("app_bypass_identifier()");
    expect(sql).toContain("id::text = app_bypass_identifier()");
    expect(sql).toContain("email = app_bypass_identifier()");
    expect(enableTenantRlsSql("notes")).not.toContain("app_bypass_identifier");
  });
});
