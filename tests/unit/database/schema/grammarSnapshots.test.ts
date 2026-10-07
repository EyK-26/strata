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

    expect(sql[0]).toContain("CREATE TABLE IF NOT EXISTS `posts`");
    expect(sql[0]).toContain("`id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY");
    expect(sql[0]).toContain("`published` BOOLEAN NOT NULL DEFAULT FALSE");
    expect(sql[0]).toContain("REFERENCES `users`(`id`) ON DELETE CASCADE");
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
      "CREATE FULLTEXT INDEX `idx_posts_fulltext` ON `posts`(`title`, `body`)",
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

describe("commerce schema contracts", () => {
  test("preserves explicit PostgreSQL varchar bounds without changing unbounded strings", () => {
    const table = new Blueprint("notes", "create");
    table.string("note", 500);
    table.string("legacy");
    expect(compileBlueprint("pgsql", table)[0]).toContain('"note" VARCHAR(500) NOT NULL');
    expect(compileBlueprint("pgsql", table)[0]).toContain('"legacy" TEXT NOT NULL');
    for (const length of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => table.string("invalid", length)).toThrow("positive safe integer");
    }
  });

  test("compiles single-column and named composite uniqueness on create", () => {
    const table = new Blueprint("identity", "create");
    table.text("provider_key");
    table.integer("tenant_id");
    table.unique("provider_key", "provider_identity");
    table.unique(["tenant_id", "provider_key"], "tenant_identity");
    const sql = compileBlueprint("pgsql", table)[0];
    expect(sql).toContain('CONSTRAINT "provider_identity" UNIQUE ("provider_key")');
    expect(sql).toContain('CONSTRAINT "tenant_identity" UNIQUE ("tenant_id", "provider_key")');
  });

  test("compiles named composite foreign keys and table checks for create and alter", () => {
    for (const driver of ["pgsql", "mysql", "sqlite"] as const) {
      const table = new Blueprint("payments", "create");
      table.integer("tenant_id");
      table.integer("order_id");
      table.foreignKey(["tenant_id", "order_id"], "orders", ["tenant_id", "id"], {
        name: "payment_binding",
        onDelete: "restrict",
      });
      table.check("order_id > tenant_id", "payment_check");
      const create = compileBlueprint(driver, table)[0]?.replaceAll("`", '"');
      expect(create).toContain(
        'CONSTRAINT "payment_binding" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "orders"("tenant_id", "id") ON DELETE RESTRICT',
      );
      expect(create).toContain('CONSTRAINT "payment_check" CHECK (order_id > tenant_id)');
      const alter = new Blueprint("payments", "alter");
      alter.foreignKey(["tenant_id", "order_id"], "orders", ["tenant_id", "id"]);
      alter.check("order_id > tenant_id", "payment_check");
      if (driver === "sqlite") {
        expect(() => compileBlueprint(driver, alter)).toThrow(UnsupportedSchemaFeatureError);
      } else {
        expect(compileBlueprint(driver, alter).map((sql) => sql.replaceAll("`", '"'))).toEqual([
          'ALTER TABLE "payments" ADD FOREIGN KEY ("tenant_id", "order_id") REFERENCES "orders"("tenant_id", "id")',
          'ALTER TABLE "payments" ADD CONSTRAINT "payment_check" CHECK (order_id > tenant_id)',
        ]);
      }
    }
  });

  test("rejects invalid constraints and snapshots caller column arrays", () => {
    const table = new Blueprint("payments", "create");
    expect(() => table.foreignKey([], "orders", [])).toThrow("nonempty");
    expect(() => table.foreignKey(["id"], "orders", ["tenant_id", "id"])).toThrow("match");
    expect(() => table.check(" ")).toThrow("must not be empty");
    const local = ["order_id"],
      remote = ["id"];
    table.foreignKey(local, "orders", remote);
    local.push("tenant_id");
    remote[0] = "other";
    expect(table.foreignKeys[0]?.columns).toEqual(["order_id"]);
    expect(table.foreignKeys[0]?.referencesColumns).toEqual(["id"]);
  });
});

test("MySQL indexes use engine syntax independent of ambient dialect", () => {
  const table = new Blueprint("payments", "alter");
  table.index("order_id", { name: "order_lookup" });
  table.dropIndex("old_lookup");
  expect(compileBlueprint("mysql", table)).toEqual([
    "DROP INDEX `old_lookup` ON `payments`",
    "CREATE INDEX `order_lookup` ON `payments`(`order_id`)",
  ]);
});
