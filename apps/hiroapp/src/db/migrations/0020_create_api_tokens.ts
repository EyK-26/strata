import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0020_create_api_tokens",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("api_token", (table) => {
        table.id();
        table.foreignId("user_id").constrained("users").cascadeOnDelete();
        table.string("name");
        table.string("token_hash").unique();
        table.jsonb("abilities").defaultRaw(`'["*"]'::jsonb`);
        table.timestamp("last_used_at").nullable();
        table.timestamp("expires_at").nullable();
        table.timestamp("created_at").defaultRaw("NOW()");
        table.index(["user_id"], { name: "idx_api_token_user_id" });
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("api_token");
    });
  },
};

export default migration;
