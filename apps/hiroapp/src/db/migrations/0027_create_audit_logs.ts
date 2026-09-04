import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { dropTenantIsolation, isolateTenantTable } from "../tenantRls.ts";

const migration: Migration = {
  name: "0027_create_audit_logs",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("audit_log", (table) => {
        table.id();
        table.foreignId("user_id").nullable().constrained("users").nullOnDelete();
        table.string("action");
        table.string("subject_type");
        table.integer("subject_id").nullable();
        table.jsonb("payload").defaultRaw("'{}'::jsonb");
        table.jsonb("previous_payload").nullable();
        table.text("ip_address").nullable();
        table.text("user_agent").nullable();
        table.string("checksum").nullable();
        table.foreignId("tenant_id").constrained("tenant");
        table.string("trace_id").nullable();
        table.timestamp("exported_at").nullable();
        table.timestamp("created_at").defaultRaw("NOW()");
        table.index(["tenant_id", "created_at"], { name: "idx_audit_log_tenant_created" });
      });
    });
    await isolateTenantTable(db, "audit_log");
  },
  async down(db) {
    await dropTenantIsolation(db, "audit_log");
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("audit_log");
    });
  },
};

export default migration;
