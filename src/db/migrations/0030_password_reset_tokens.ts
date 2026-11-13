import { Schema } from "../../framework/public-api.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0030_password_reset_tokens",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("password_reset_token", (table) => {
        table.string("email").unique();
        table.string("token");
        table.timestamp("created_at").defaultRaw("NOW()");
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("password_reset_token");
    });
  },
};

export default migration;
