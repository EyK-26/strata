import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0017_create_failed_jobs",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("failed_job", (table) => {
        table.id();
        table.string("job_name");
        table.jsonb("payload");
        table.text("exception");
        table.timestamp("failed_at").defaultRaw("NOW()");
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("failed_job");
    });
  },
};

export default migration;
