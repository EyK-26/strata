import type { Migration } from "./types";

const migration: Migration = {
  name: "0002_create_nemesis",
  async up(db) {
    await db`
      CREATE TABLE IF NOT EXISTS nemesis (
        id INTEGER PRIMARY KEY,
        is_alive BOOLEAN NOT NULL,
        years INTEGER NOT NULL CHECK (years >= 0),
        character_id INTEGER NOT NULL REFERENCES "character"(id) ON DELETE CASCADE
      )
    `;

    await db`
      CREATE INDEX IF NOT EXISTS idx_nemesis_character_id
      ON nemesis(character_id)
    `;
  },
  async down(db) {
    await db`DROP TABLE IF EXISTS nemesis CASCADE`;
  },
};

export default migration;
