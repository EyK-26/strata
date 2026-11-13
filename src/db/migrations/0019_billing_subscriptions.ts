import { Schema } from "../../framework/public-api.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0019_billing_subscriptions",
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
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.drop("subscription");
      schema.table("tenant", (table) => {
        table.dropColumn("stripe_customer_id");
      });
    });
  },
};

export default migration;
