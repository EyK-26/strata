import type { Migration } from "./types";

const migration: Migration = {
  name: "0001_create_character",
  async up(db) {
    await db`
      CREATE TABLE IF NOT EXISTS "character" (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        gender TEXT NOT NULL,
        ability TEXT NOT NULL,
        minimal_distance TEXT NOT NULL,
        weight INTEGER NOT NULL CHECK (weight >= 0),
        born DATE NOT NULL,
        in_space_since DATE NOT NULL,
        beer_consumption INTEGER NOT NULL CHECK (beer_consumption >= 0),
        knows_the_answer BOOLEAN NOT NULL DEFAULT FALSE
      )
    `;
  },
  async down(db) {
    await db`DROP TABLE IF EXISTS "character" CASCADE`;
  },
};

export default migration;
