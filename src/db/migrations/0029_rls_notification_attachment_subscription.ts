import type { Migration } from "./types";

const TENANT_TABLES = ["notification", "task_attachment", "subscription"] as const;

const migration: Migration = {
  name: "0029_rls_notification_attachment_subscription",
  async up(db) {
    for (const tableName of TENANT_TABLES) {
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
  },
  async down(db) {
    for (const tableName of [...TENANT_TABLES].reverse()) {
      await db.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON ${tableName}`);
    }
  },
};

export default migration;
