import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { dropTenantIsolation, isolateTenantTable } from "../tenantRls.ts";

const migration: Migration = {
  name: "0028_create_webhooks",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.create("webhook", (table) => {
        table.id();
        table.foreignId("department_id").nullable().constrained("departments").nullOnDelete();
        table.foreignId("tenant_id").constrained("tenant");
        table.text("url");
        table.text("secret");
        table.jsonb("events").defaultRaw(`'["*"]'::jsonb`);
        table.boolean("active").default(true);
        table.timestamp("created_at").defaultRaw("NOW()");
        table.index(["tenant_id"], { name: "idx_webhook_tenant_id" });
      });
      schema.create("webhook_delivery", (table) => {
        table.id();
        table.foreignId("webhook_id").constrained("webhook").cascadeOnDelete();
        table.foreignId("tenant_id").constrained("tenant");
        table.string("event");
        table.jsonb("payload");
        table.integer("response_status").nullable();
        table.text("error").nullable();
        table.timestamp("created_at").defaultRaw("NOW()");
        table.index(["webhook_id"], { name: "idx_webhook_delivery_webhook_id" });
      });
    });
    await isolateTenantTable(db, "webhook");
    await isolateTenantTable(db, "webhook_delivery");
  },
  async down(db) {
    await dropTenantIsolation(db, "webhook_delivery");
    await dropTenantIsolation(db, "webhook");
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("webhook_delivery");
      schema.drop("webhook");
    });
  },
};

export default migration;
