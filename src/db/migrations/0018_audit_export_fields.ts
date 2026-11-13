import { Schema } from "../../framework/public-api.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0018_audit_export_fields",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("audit_log", (table) => {
        table.integer("tenant_id").nullable();
        table.string("trace_id").nullable();
        table.timestamp("exported_at").nullable();
        table.partialIndex(["exported_at"], "exported_at IS NULL", "idx_audit_log_exported_at");
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("audit_log", (table) => {
        table.dropIndex("idx_audit_log_exported_at");
        table.dropColumn("exported_at");
        table.dropColumn("trace_id");
        table.dropColumn("tenant_id");
      });
    });
  },
};

export default migration;
