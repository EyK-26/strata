import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { dropTenantIsolation, isolateTenantTable } from "../tenantRls.ts";

const migration: Migration = {
  name: "0029_create_billing",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("tenant", (table) => {
        table.string("stripe_customer_id").nullable().unique();
      });
      schema.create("subscription", (table) => {
        table.id();
        table.foreignId("tenant_id").constrained("tenant").cascadeOnDelete();
        table.string("stripe_subscription_id").nullable().unique();
        table.string("plan").check("plan IN ('free', 'pro', 'enterprise')");
        table
          .string("status")
          .default("active")
          .check("status IN ('active', 'past_due', 'canceled', 'trialing')");
        table.timestamp("current_period_end").nullable();
        table.timestamps();
        table.index(["tenant_id"], { name: "idx_subscription_tenant_id" });
      });
      schema.create("stripe_webhook_event", (table) => {
        table.string("id").primary();
        table.string("event_type");
        table.foreignId("tenant_id").nullable().constrained("tenant");
        table.timestamp("processed_at").defaultRaw("NOW()");
      });
    });
    await isolateTenantTable(db, "subscription");
    await db.unsafe(`
      INSERT INTO subscription (tenant_id, plan, status, created_at, updated_at)
      SELECT id, plan, 'active', NOW(), NOW()
      FROM tenant
      WHERE NOT EXISTS (
        SELECT 1 FROM subscription WHERE subscription.tenant_id = tenant.id
      )
    `);
  },
  async down(db) {
    await dropTenantIsolation(db, "subscription");
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("stripe_webhook_event");
      schema.drop("subscription");
      schema.table("tenant", (table) => {
        table.dropColumn("stripe_customer_id");
      });
    });
  },
};

export default migration;
