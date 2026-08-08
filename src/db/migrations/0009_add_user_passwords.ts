import type { Migration } from "./types";

const migration: Migration = {
  name: "0009_add_user_passwords",
  async up(db) {
    await db`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS password_hash TEXT
    `;
  },
  async down(db) {
    await db`
      ALTER TABLE users
      DROP COLUMN IF EXISTS password_hash
    `;
  },
};

export default migration;
