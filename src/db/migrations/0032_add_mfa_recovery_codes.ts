import { Schema } from "../../framework/public-api.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0032_add_mfa_recovery_codes",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("users", (table) => {
        table.string("mfa_recovery_codes").nullable();
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("users", (table) => {
        table.dropColumn("mfa_recovery_codes");
      });
    });
  },
};

export default migration;
