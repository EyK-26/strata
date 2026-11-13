import { Schema } from "../../framework/public-api.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0035_add_user_session_valid_after",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("users", (table) => {
        table.timestamp("session_valid_after").nullable();
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("users", (table) => {
        table.dropColumn("session_valid_after");
      });
    });
  },
};

export default migration;
