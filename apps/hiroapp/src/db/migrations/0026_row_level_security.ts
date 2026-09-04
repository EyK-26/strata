import type { Migration } from "@getstrata/core/database/migrations/types";

const TENANT_TABLES = [
  "users",
  "departments",
  "positions",
  "applications",
  "notifications",
  "comments",
  "department_members",
  "department_invitations",
  "api_token",
] as const;

const migration: Migration = {
  name: "0026_row_level_security",
  async up(db) {
    await db.unsafe(`
      CREATE OR REPLACE FUNCTION app_bypass_rls()
      RETURNS BOOLEAN AS $$
      BEGIN
        RETURN COALESCE(current_setting('app.bypass_rls', true), 'false') = 'true';
      EXCEPTION
        WHEN others THEN
          RETURN FALSE;
      END;
      $$ LANGUAGE plpgsql STABLE
    `);

    await db.unsafe(`
      CREATE OR REPLACE FUNCTION app_current_tenant_id()
      RETURNS INTEGER AS $$
      BEGIN
        RETURN NULLIF(current_setting('app.tenant_id', true), '')::INTEGER;
      EXCEPTION
        WHEN others THEN
          RETURN NULL;
      END;
      $$ LANGUAGE plpgsql STABLE
    `);

    await db.unsafe(`
      CREATE OR REPLACE FUNCTION app_set_tenant_id()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.tenant_id IS NULL THEN
          NEW.tenant_id := COALESCE(app_current_tenant_id(), 1);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    for (const tableName of TENANT_TABLES) {
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
  },
  async down(db) {
    for (const tableName of [...TENANT_TABLES].reverse()) {
      await db.unsafe(`DROP TRIGGER IF EXISTS trg_${tableName}_set_tenant_id ON ${tableName}`);
      await db.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON ${tableName}`);
      await db.unsafe(`ALTER TABLE ${tableName} DISABLE ROW LEVEL SECURITY`);
    }
    await db.unsafe(`DROP FUNCTION IF EXISTS app_set_tenant_id()`);
    await db.unsafe(`DROP FUNCTION IF EXISTS app_current_tenant_id()`);
    await db.unsafe(`DROP FUNCTION IF EXISTS app_bypass_rls()`);
  },
};

export default migration;
