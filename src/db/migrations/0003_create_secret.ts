import type { Migration } from "./types";

const migration: Migration = {
  name: "0003_create_secret",
  async up(db) {
    await db`
      CREATE TABLE IF NOT EXISTS secret (
        id INTEGER PRIMARY KEY,
        secret_code TEXT NOT NULL,
        nemesis_id INTEGER NOT NULL REFERENCES nemesis(id) ON DELETE CASCADE
      )
    `;

    await db`
      CREATE INDEX IF NOT EXISTS idx_secret_nemesis_id
      ON secret(nemesis_id)
    `;
  },
  async down(db) {
    await db`DROP TABLE IF EXISTS secret CASCADE`;
  },
};

export default migration;
