import type { Migration } from "@getstrata/core/database/migrations/types";

const constraint = "interviews_status_check";
const allowed =
  "status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show', 'declined')";
const previous = "status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')";

const migration: Migration = {
  name: "0049_add_interview_declined",
  async up(db) {
    await db.unsafe(`ALTER TABLE interviews DROP CONSTRAINT IF EXISTS ${constraint}`);
    await db.unsafe(`ALTER TABLE interviews ADD CONSTRAINT ${constraint} CHECK (${allowed})`);
  },
  async down(db) {
    await db.unsafe(`UPDATE interviews SET status = 'cancelled' WHERE status = 'declined'`);
    await db.unsafe(`ALTER TABLE interviews DROP CONSTRAINT IF EXISTS ${constraint}`);
    await db.unsafe(`ALTER TABLE interviews ADD CONSTRAINT ${constraint} CHECK (${previous})`);
  },
};

export default migration;
