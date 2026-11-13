import type { Migration } from "./types";

const migration: Migration = {
  name: "0013_add_full_text_search",
  async up(db) {
    await db.unsafe(
      `
      ALTER TABLE task
      ADD COLUMN IF NOT EXISTS search_vector tsvector
    `,
      [],
    );
    await db.unsafe(
      `
      ALTER TABLE comment
      ADD COLUMN IF NOT EXISTS search_vector tsvector
    `,
      [],
    );
    await db.unsafe(
      `
      UPDATE task
      SET search_vector = to_tsvector('english', coalesce(title, ''))
    `,
      [],
    );
    await db.unsafe(
      `
      UPDATE comment
      SET search_vector = to_tsvector('english', coalesce(body, ''))
    `,
      [],
    );
    await db.unsafe(
      `
      CREATE INDEX IF NOT EXISTS idx_task_search_vector ON task USING GIN(search_vector)
    `,
      [],
    );
    await db.unsafe(
      `
      CREATE INDEX IF NOT EXISTS idx_comment_search_vector ON comment USING GIN(search_vector)
    `,
      [],
    );
    await db.unsafe(
      `
      CREATE OR REPLACE FUNCTION task_search_vector_update() RETURNS trigger AS $$
      BEGIN
        NEW.search_vector := to_tsvector('english', coalesce(NEW.title, ''));
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql
    `,
      [],
    );
    await db.unsafe(
      `
      CREATE OR REPLACE FUNCTION comment_search_vector_update() RETURNS trigger AS $$
      BEGIN
        NEW.search_vector := to_tsvector('english', coalesce(NEW.body, ''));
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql
    `,
      [],
    );
    await db.unsafe(
      `
      DROP TRIGGER IF EXISTS task_search_vector_trigger ON task
    `,
      [],
    );
    await db.unsafe(
      `
      CREATE TRIGGER task_search_vector_trigger
      BEFORE INSERT OR UPDATE ON task
      FOR EACH ROW EXECUTE FUNCTION task_search_vector_update()
    `,
      [],
    );
    await db.unsafe(
      `
      DROP TRIGGER IF EXISTS comment_search_vector_trigger ON comment
    `,
      [],
    );
    await db.unsafe(
      `
      CREATE TRIGGER comment_search_vector_trigger
      BEFORE INSERT OR UPDATE ON comment
      FOR EACH ROW EXECUTE FUNCTION comment_search_vector_update()
    `,
      [],
    );
  },
  async down(db) {
    await db.unsafe(`DROP TRIGGER IF EXISTS comment_search_vector_trigger ON comment`, []);
    await db.unsafe(`DROP TRIGGER IF EXISTS task_search_vector_trigger ON task`, []);
    await db.unsafe(`DROP FUNCTION IF EXISTS comment_search_vector_update()`, []);
    await db.unsafe(`DROP FUNCTION IF EXISTS task_search_vector_update()`, []);
    await db.unsafe(`DROP INDEX IF EXISTS idx_comment_search_vector`, []);
    await db.unsafe(`DROP INDEX IF EXISTS idx_task_search_vector`, []);
    await db.unsafe(`ALTER TABLE comment DROP COLUMN IF EXISTS search_vector`, []);
    await db.unsafe(`ALTER TABLE task DROP COLUMN IF EXISTS search_vector`, []);
  },
};

export default migration;
