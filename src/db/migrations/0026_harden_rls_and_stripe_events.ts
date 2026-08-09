import type { Migration } from "./types";

const migration: Migration = {
  name: "0026_harden_rls_and_stripe_events",
  async up(db) {
    await db`
      CREATE OR REPLACE FUNCTION app_bypass_rls()
      RETURNS BOOLEAN AS $$
      BEGIN
        RETURN COALESCE(current_setting('app.bypass_rls', true), 'false') = 'true';
      EXCEPTION
        WHEN others THEN
          RETURN FALSE;
      END;
      $$ LANGUAGE plpgsql STABLE
    `;

    await db`
      CREATE OR REPLACE FUNCTION app_current_tenant_id()
      RETURNS INTEGER AS $$
      BEGIN
        RETURN NULLIF(current_setting('app.tenant_id', true), '')::INTEGER;
      EXCEPTION
        WHEN others THEN
          RETURN NULL;
      END;
      $$ LANGUAGE plpgsql STABLE
    `;

    const tables = ["organization", "users", "audit_log", "project", "task", "comment", "webhook"];

    for (const tableName of tables) {
      await db.unsafe(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY`);
      await db.unsafe(`ALTER TABLE ${tableName} FORCE ROW LEVEL SECURITY`);
      await db.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON ${tableName}`);
      await db.unsafe(`
        CREATE POLICY tenant_isolation ON ${tableName}
        USING (
          app_bypass_rls()
          OR tenant_id = app_current_tenant_id()
        )
        WITH CHECK (
          app_bypass_rls()
          OR tenant_id = app_current_tenant_id()
        )
      `);
    }

    await db`
      CREATE TABLE IF NOT EXISTS stripe_webhook_event (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        tenant_id INTEGER REFERENCES tenant(id),
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_stripe_webhook_event_processed_at
      ON stripe_webhook_event(processed_at)
    `;

    await db`
      ALTER TABLE webhook_delivery
      ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS error TEXT
    `;
  },
  async down(db) {
    await db`DROP TABLE IF EXISTS stripe_webhook_event`;
    await db`ALTER TABLE webhook_delivery DROP COLUMN IF EXISTS attempt`;
    await db`ALTER TABLE webhook_delivery DROP COLUMN IF EXISTS error`;

    const tables = ["webhook", "comment", "task", "project", "audit_log", "users", "organization"];

    for (const tableName of tables) {
      await db.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON ${tableName}`);
    }

    await db`DROP FUNCTION IF EXISTS app_bypass_rls()`;
  },
};

export default migration;
