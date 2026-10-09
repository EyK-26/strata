import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0004_initial_admin_provisioning",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("initial_admin_provisioning", (table) => {
        table.integer("id").primary();
        table.text("email");
        table.timestamp("provisioned_at").defaultRaw("CURRENT_TIMESTAMP");
      });
    });
  },
  async down(db) {
    if ((await db.unsafe("SELECT id FROM initial_admin_provisioning")).length) {
      throw new Error("Cannot discard a completed initial-admin provisioning claim.");
    }
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("initial_admin_provisioning");
    });
  },
};
export default migration;
