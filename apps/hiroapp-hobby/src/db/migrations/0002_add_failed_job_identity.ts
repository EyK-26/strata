import type { Migration } from "@getstrata/core/database/migrations/types";
import { resolveDatabaseDriver, Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0002_add_failed_job_identity",
  async up(db) {
    await Schema.run(db, resolveDatabaseDriver(), (schema) => {
      schema.table("failed_job", (table) => {
        table.text("job_id").nullable();
      });
    });
  },
  async down(db) {
    await Schema.run(db, resolveDatabaseDriver(), (schema) => {
      schema.table("failed_job", (table) => {
        table.dropColumn("job_id");
      });
    });
  },
};
export default migration;
