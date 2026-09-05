import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const constraint = "career_postings_status_check";
const allowed = "status IN ('published', 'unpublished', 'expired', 'scheduled')";
const previous = "status IN ('published', 'unpublished', 'expired')";

const migration: Migration = {
  name: "0052_add_scheduled_career_publish",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("career_postings", (table) => {
        table.timestamp("publish_at").nullable();
      });
    });
    await db.unsafe(`ALTER TABLE career_postings DROP CONSTRAINT IF EXISTS ${constraint}`);
    await db.unsafe(`ALTER TABLE career_postings ADD CONSTRAINT ${constraint} CHECK (${allowed})`);
  },
  async down(db) {
    await db.unsafe(`UPDATE career_postings SET status = 'unpublished' WHERE status = 'scheduled'`);
    await db.unsafe(`ALTER TABLE career_postings DROP CONSTRAINT IF EXISTS ${constraint}`);
    await db.unsafe(`ALTER TABLE career_postings ADD CONSTRAINT ${constraint} CHECK (${previous})`);
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("career_postings", (table) => {
        table.dropColumn("publish_at");
      });
    });
  },
};

export default migration;
