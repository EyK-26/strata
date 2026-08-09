import { describe, expect, test } from "bun:test";
import {
  Blueprint,
  compileBlueprint,
  UnsupportedSchemaFeatureError,
} from "@getstrata/core/database/schema";

function buildSampleBlueprint(): Blueprint {
  const blueprint = new Blueprint("posts", "create");

  blueprint.id();
  blueprint.string("title");
  blueprint.text("body").nullable();
  blueprint.boolean("published").default(false);
  blueprint.foreignId("user_id").constrained("users").cascadeOnDelete();
  blueprint.timestamps();
  blueprint.softDeletes();
  blueprint.unique(["user_id", "title"]);
  blueprint.index(["published"], { name: "idx_posts_published" });

  return blueprint;
}

describe("PostgresGrammar", () => {
  test("compiles create table blueprint", () => {
    const sql = compileBlueprint("pgsql", buildSampleBlueprint());

    expect(sql).toEqual([
      `CREATE TABLE IF NOT EXISTS "posts" (
  "id" SERIAL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "body" TEXT NULL,
  "published" BOOLEAN NOT NULL DEFAULT FALSE,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ NULL,
  UNIQUE ("user_id", "title")
)`,
      `CREATE INDEX IF NOT EXISTS "idx_posts_published" ON "posts"("published")`,
    ]);
  });

  test("compiles partial and gin indexes", () => {
    const blueprint = new Blueprint("notification", "create");
    blueprint.id();
    blueprint.partialIndex(["user_id"], "read_at IS NULL", "idx_notification_user_unread");
    blueprint.ginIndex("search_vector", "idx_notification_search");

    expect(compileBlueprint("pgsql", blueprint)).toEqual([
      `CREATE TABLE IF NOT EXISTS "notification" (
  "id" SERIAL PRIMARY KEY
)`,
      `CREATE INDEX IF NOT EXISTS "idx_notification_user_unread" ON "notification"("user_id") WHERE read_at IS NULL`,
      `CREATE INDEX IF NOT EXISTS "idx_notification_search" ON "notification" USING GIN("search_vector")`,
    ]);
  });

  test("compiles alter table additions", () => {
    const blueprint = new Blueprint("users", "alter");
    blueprint.string("stripe_customer_id").nullable().unique();
    blueprint.softDeletes();
    blueprint.index(["deleted_at"], { name: "idx_users_deleted_at" });

    expect(compileBlueprint("pgsql", blueprint)).toEqual([
      `ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "stripe_customer_id" TEXT NULL UNIQUE`,
      `ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ NULL`,
      `CREATE INDEX IF NOT EXISTS "idx_users_deleted_at" ON "users"("deleted_at")`,
    ]);
  });
});

describe("MySqlGrammar", () => {
  test("compiles create table blueprint", () => {
    const sql = compileBlueprint("mysql", buildSampleBlueprint());

    expect(sql[0]).toContain('CREATE TABLE IF NOT EXISTS "posts"');
    expect(sql[0]).toContain('"id" BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY');
    expect(sql[0]).toContain('"published" BOOLEAN NOT NULL DEFAULT FALSE');
    expect(sql[0]).toContain('REFERENCES "users"("id") ON DELETE CASCADE');
  });

  test("rejects partial indexes", () => {
    const blueprint = new Blueprint("notification", "alter");
    blueprint.partialIndex(["user_id"], "read_at IS NULL");

    expect(() => compileBlueprint("mysql", blueprint)).toThrow(UnsupportedSchemaFeatureError);
  });

  test("compiles full text indexes", () => {
    const blueprint = new Blueprint("posts", "alter");
    blueprint.fullText(["title", "body"], "idx_posts_fulltext");

    expect(compileBlueprint("mysql", blueprint)).toEqual([
      `CREATE FULLTEXT INDEX "idx_posts_fulltext" ON "posts"("title", "body")`,
    ]);
  });
});

describe("SqliteGrammar", () => {
  test("compiles create table blueprint", () => {
    const sql = compileBlueprint("sqlite", buildSampleBlueprint());

    expect(sql[0]).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(sql[0]).toContain('"published" INTEGER NOT NULL DEFAULT FALSE');
  });

  test("rejects gin indexes", () => {
    const blueprint = new Blueprint("task", "alter");
    blueprint.ginIndex("search_vector");

    expect(() => compileBlueprint("sqlite", blueprint)).toThrow(UnsupportedSchemaFeatureError);
  });
});

describe("SchemaBuilder integration", () => {
  test("drops tables with cascade on postgres", () => {
    const blueprint = new Blueprint("sessions", "drop");
    expect(compileBlueprint("pgsql", blueprint)).toEqual([
      'DROP TABLE IF EXISTS "sessions" CASCADE',
    ]);
  });
});
