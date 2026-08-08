import type { Migration } from "./types";

const migration: Migration = {
  name: "0020_add_user_email_encryption",
  async up(db) {
    await db`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS email_lookup TEXT
    `;
    await db`
      UPDATE users
      SET email_lookup = LOWER(TRIM(email))
      WHERE email_lookup IS NULL
    `;
    await db`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lookup
      ON users(email_lookup)
      WHERE email_lookup IS NOT NULL
    `;
  },
  async down(db) {
    await db`DROP INDEX IF EXISTS idx_users_email_lookup`;
    await db`ALTER TABLE users DROP COLUMN IF EXISTS email_lookup`;
  },
};

export default migration;
