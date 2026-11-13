import { Schema } from "../../framework/public-api.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0010_create_oauth_identities",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("oauth_identity", (table) => {
        table.id();
        table.foreignId("user_id").constrained("users").cascadeOnDelete();
        table.string("provider");
        table.string("provider_user_id");
        table.string("email").nullable();
        table.timestamp("created_at").defaultRaw("NOW()");
        table.unique(["provider", "provider_user_id"]);
        table.index(["user_id"], { name: "idx_oauth_identity_user_id" });
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("oauth_identity");
    });
  },
};

export default migration;
