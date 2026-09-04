import type { MigrationDatabase } from "@getstrata/core/database/migrations/types";

async function isolateTenantTable(db: MigrationDatabase, tableName: string): Promise<void> {
  await db.unsafe(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY`);
  await db.unsafe(`ALTER TABLE ${tableName} FORCE ROW LEVEL SECURITY`);
  await db.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON ${tableName}`);
  await db.unsafe(`
    CREATE POLICY tenant_isolation ON ${tableName}
    USING (
      app_bypass_rls()
      OR app_current_tenant_id() IS NULL
      OR tenant_id = app_current_tenant_id()
    )
    WITH CHECK (
      app_bypass_rls()
      OR app_current_tenant_id() IS NULL
      OR tenant_id = app_current_tenant_id()
    )
  `);
  await db.unsafe(`DROP TRIGGER IF EXISTS trg_${tableName}_set_tenant_id ON ${tableName}`);
  await db.unsafe(`
    CREATE TRIGGER trg_${tableName}_set_tenant_id
    BEFORE INSERT ON ${tableName}
    FOR EACH ROW
    EXECUTE FUNCTION app_set_tenant_id()
  `);
}

async function dropTenantIsolation(db: MigrationDatabase, tableName: string): Promise<void> {
  await db.unsafe(`DROP TRIGGER IF EXISTS trg_${tableName}_set_tenant_id ON ${tableName}`);
  await db.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON ${tableName}`);
  await db.unsafe(`ALTER TABLE ${tableName} DISABLE ROW LEVEL SECURITY`);
}

export { dropTenantIsolation, isolateTenantTable };
