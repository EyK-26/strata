import { Schema } from "../../framework/public-api.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0038_add_failed_job_identity",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("failed_job", (table) => {
        table.text("job_id").nullable();
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("failed_job", (table) => {
        table.dropColumn("job_id");
      });
    });
  },
};
export default migration;
