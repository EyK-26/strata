import type { Migration } from "./types";

const migration: Migration = {
  name: "0017_rbac_indexes",
  async up(db) {
    await db`
      CREATE INDEX IF NOT EXISTS idx_organization_member_user_id
      ON organization_member(user_id)
    `;
  },
  async down(db) {
    await db`DROP INDEX IF EXISTS idx_organization_member_user_id`;
  },
};

export default migration;
