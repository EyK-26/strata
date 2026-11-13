import type { Migration } from "./types";

const migration: Migration = {
  name: "0024_row_level_security",
  async up(db) {
    await db.unsafe(
      `
      CREATE OR REPLACE FUNCTION app_current_tenant_id()
      RETURNS INTEGER AS $$
      BEGIN
        RETURN NULLIF(current_setting('app.tenant_id', true), '')::INTEGER;
      EXCEPTION
        WHEN others THEN
          RETURN NULL;
      END;
      $$ LANGUAGE plpgsql STABLE
    `,
      [],
    );

    await db.unsafe(`ALTER TABLE organization ENABLE ROW LEVEL SECURITY`, []);
    await db.unsafe(`ALTER TABLE organization FORCE ROW LEVEL SECURITY`, []);
    await db.unsafe(
      `
      DROP POLICY IF EXISTS tenant_isolation ON organization
    `,
      [],
    );
    await db.unsafe(
      `
      CREATE POLICY tenant_isolation ON organization
      USING (
        app_current_tenant_id() IS NULL
        OR tenant_id = app_current_tenant_id()
      )
      WITH CHECK (
        app_current_tenant_id() IS NULL
        OR tenant_id = app_current_tenant_id()
      )
    `,
      [],
    );

    await db.unsafe(`ALTER TABLE users ENABLE ROW LEVEL SECURITY`, []);
    await db.unsafe(`ALTER TABLE users FORCE ROW LEVEL SECURITY`, []);
    await db.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON users`, []);
    await db.unsafe(
      `
      CREATE POLICY tenant_isolation ON users
      USING (
        app_current_tenant_id() IS NULL
        OR tenant_id = app_current_tenant_id()
      )
      WITH CHECK (
        app_current_tenant_id() IS NULL
        OR tenant_id = app_current_tenant_id()
      )
    `,
      [],
    );

    await db.unsafe(`ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY`, []);
    await db.unsafe(`ALTER TABLE audit_log FORCE ROW LEVEL SECURITY`, []);
    await db.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON audit_log`, []);
    await db.unsafe(
      `
      CREATE POLICY tenant_isolation ON audit_log
      USING (
        app_current_tenant_id() IS NULL
        OR tenant_id = app_current_tenant_id()
      )
      WITH CHECK (
        app_current_tenant_id() IS NULL
        OR tenant_id = app_current_tenant_id()
      )
    `,
      [],
    );
  },
  async down(db) {
    await db.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON audit_log`, []);
    await db.unsafe(`ALTER TABLE audit_log DISABLE ROW LEVEL SECURITY`, []);
    await db.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON users`, []);
    await db.unsafe(`ALTER TABLE users DISABLE ROW LEVEL SECURITY`, []);
    await db.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON organization`, []);
    await db.unsafe(`ALTER TABLE organization DISABLE ROW LEVEL SECURITY`, []);
    await db.unsafe(`DROP FUNCTION IF EXISTS app_current_tenant_id()`, []);
  },
};

export default migration;
