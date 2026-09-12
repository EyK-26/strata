import { describe, expect, test } from "bun:test";
import {
  enableTenantRlsSql,
  generatedRlsBootstrapSql,
  RLS_HELPER_SQL,
} from "@getstrata/core/tenant/enableTenantRls";

describe("enableTenantRls", () => {
  test("rejects unsafe table names", () => {
    expect(() => enableTenantRlsSql("notes; drop table users")).toThrow("Invalid SQL identifier");
    expect(() => enableTenantRlsSql("1notes")).toThrow("Invalid SQL identifier");
  });

  test("emits FORCE RLS and a tenant isolation policy", () => {
    const sql = enableTenantRlsSql("notes");
    expect(sql).toContain("ALTER TABLE notes ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE notes FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("CREATE POLICY tenant_isolation ON notes");
    expect(sql).toContain("tenant_id = app_current_tenant_id()");
    expect(sql).toContain("app_bypass_rls()");
  });

  test("bootstraps helper functions plus each table", () => {
    const sql = generatedRlsBootstrapSql(["notes", "projects"]);
    expect(sql).toContain(RLS_HELPER_SQL.trim().slice(0, 40));
    expect(sql).toContain("app_current_tenant_id");
    expect(sql).toContain("ALTER TABLE notes ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE projects ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE notes FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE projects FORCE ROW LEVEL SECURITY");
  });

  test("generated bootstrap FORCE RLS includes users when listed", () => {
    const sql = generatedRlsBootstrapSql(["notes", "users"]);
    expect(sql).toContain("ALTER TABLE users ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE users FORCE ROW LEVEL SECURITY");
  });
});
