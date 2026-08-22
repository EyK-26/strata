import { describe, expect, test } from "bun:test";
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

  test("keeps api_token and organization_member auth-global without tenant RLS", async () => {
    const rows = (await db`
      SELECT tablename
      FROM pg_policies
      WHERE policyname = 'tenant_isolation'
        AND tablename IN ('api_token', 'organization_member')
    `) as Array<{ tablename: string }>;

    expect(rows).toEqual([]);
  });
});
