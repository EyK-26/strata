import type { Migration } from "../../database/migrations/types";
import type { DatabaseDriver } from "../../database/schema/driver";

/** Infrastructure tables belong to core; apps choose the file migration name and RLS mode. */
function createOutboxMigration(
  name: string,
  driver: DatabaseDriver,
  options: { rls?: boolean } = {},
): Migration {
  const identity = driver === "mysql" ? " CHARACTER SET ascii COLLATE ascii_bin" : "";
  const payloadType = driver === "mysql" ? "MEDIUMTEXT" : "TEXT";
  const inlineIndex =
    driver === "mysql"
      ? ", INDEX strata_outbox_due (status, available_at, event_id, listener_name), INDEX strata_outbox_expired (status, lease_until, event_id, listener_name)"
      : "";
  return {
    name,
    async up(db) {
      await db.unsafe(`CREATE TABLE IF NOT EXISTS strata_outbox_event (
        id VARCHAR(64)${identity} PRIMARY KEY, name VARCHAR(128)${identity} NOT NULL, version INTEGER NOT NULL CHECK (version > 0),
        tenant_id BIGINT, payload ${payloadType} NOT NULL, created_at BIGINT NOT NULL,
        publication_token VARCHAR(64)${identity} NOT NULL)`);
      await db.unsafe(`CREATE TABLE IF NOT EXISTS strata_outbox_delivery (
        event_id VARCHAR(64)${identity} NOT NULL,
        listener_name VARCHAR(128)${identity} NOT NULL, status VARCHAR(16) NOT NULL CHECK (status IN ('pending', 'processing', 'failed', 'completed')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0), max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
        available_at BIGINT NOT NULL, lease_token VARCHAR(64)${identity}, lease_until BIGINT,
        completed_at BIGINT, error_code VARCHAR(64), PRIMARY KEY (event_id, listener_name)${inlineIndex},
        FOREIGN KEY (event_id) REFERENCES strata_outbox_event(id) ON DELETE CASCADE)`);
      if (driver !== "mysql") {
        await db.unsafe(
          "CREATE INDEX IF NOT EXISTS strata_outbox_due ON strata_outbox_delivery (status, available_at, event_id, listener_name)",
        );
        await db.unsafe(
          "CREATE INDEX IF NOT EXISTS strata_outbox_expired ON strata_outbox_delivery (status, lease_until, event_id, listener_name)",
        );
      }
      if (driver === "pgsql" && options.rls) {
        await db.unsafe(`ALTER TABLE strata_outbox_event ENABLE ROW LEVEL SECURITY`);
        await db.unsafe(`ALTER TABLE strata_outbox_event FORCE ROW LEVEL SECURITY`);
        await db.unsafe(`DROP POLICY IF EXISTS strata_outbox_scope ON strata_outbox_event`);
        await db.unsafe(`CREATE POLICY strata_outbox_scope ON strata_outbox_event USING (
          current_setting('app.bypass_rls', true) = 'true' OR
          tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint OR
          (tenant_id IS NULL AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL))`);
        await db.unsafe(`ALTER TABLE strata_outbox_delivery ENABLE ROW LEVEL SECURITY`);
        await db.unsafe(`ALTER TABLE strata_outbox_delivery FORCE ROW LEVEL SECURITY`);
        await db.unsafe(`DROP POLICY IF EXISTS strata_outbox_scope ON strata_outbox_delivery`);
        await db.unsafe(`CREATE POLICY strata_outbox_scope ON strata_outbox_delivery USING (
          current_setting('app.bypass_rls', true) = 'true' OR EXISTS (
          SELECT 1 FROM strata_outbox_event WHERE id = strata_outbox_delivery.event_id))`);
      }
    },
    async down(db) {
      const [row] = await db.unsafe<{ pending: number }>(
        "SELECT COUNT(*) AS pending FROM strata_outbox_delivery WHERE status <> 'completed'",
      );
      if (Number(row?.pending) > 0)
        throw new Error("Cannot drop outbox tables while undelivered events remain.");
      await db.unsafe("DROP TABLE strata_outbox_delivery");
      await db.unsafe("DROP TABLE strata_outbox_event");
    },
  };
}

export { createOutboxMigration };
