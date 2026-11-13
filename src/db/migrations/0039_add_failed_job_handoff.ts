import { Schema } from "../../framework/public-api.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0039_add_failed_job_handoff",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("failed_job", (table) => {
        table.text("handoff").nullable();
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("failed_job", (table) => {
        table.dropColumn("handoff");
      });
    });
  },
};
export default migration;
