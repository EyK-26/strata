import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const constraint = "offers_status_check";
const allowed = "status IN ('draft', 'sent', 'accepted', 'declined', 'withdrawn', 'expired')";
const previous = "status IN ('draft', 'sent', 'accepted', 'declined', 'withdrawn')";

const migration: Migration = {
  name: "0047_add_offer_expiry",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("offers", (table) => {
        table.timestamp("expires_at").nullable();
      });
    });
    await db.unsafe(`ALTER TABLE offers DROP CONSTRAINT IF EXISTS ${constraint}`);
    await db.unsafe(`ALTER TABLE offers ADD CONSTRAINT ${constraint} CHECK (${allowed})`);
  },
  async down(db) {
    await db.unsafe(`UPDATE offers SET status = 'withdrawn' WHERE status = 'expired'`);
    await db.unsafe(`ALTER TABLE offers DROP CONSTRAINT IF EXISTS ${constraint}`);
    await db.unsafe(`ALTER TABLE offers ADD CONSTRAINT ${constraint} CHECK (${previous})`);
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("offers", (table) => {
        table.dropColumn("expires_at");
      });
    });
  },
};

export default migration;
