import { Schema } from "../../framework/public-api.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0008_create_failed_jobs",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("failed_job", (table) => {
        table.id();
        table.string("job_name");
        table.jsonb("payload");
        table.text("exception");
        table.timestamp("failed_at").defaultRaw("NOW()");
        table.index(["job_name"], { name: "idx_failed_job_name" });
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
