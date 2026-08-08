import type { Migration } from "./types";

const migration: Migration = {
  name: "0019_billing_subscriptions",
  async up(db) {
    await db`
      ALTER TABLE tenant
      ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE
    `;
    await db`
      CREATE TABLE IF NOT EXISTS subscription (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        stripe_subscription_id TEXT UNIQUE,
        plan TEXT NOT NULL CHECK (plan IN ('free', 'pro', 'enterprise')),
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'past_due', 'canceled', 'trialing')),
        current_period_end TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_subscription_tenant_id ON subscription(tenant_id)
    `;
  },
  async down(db) {
    await db`DROP TABLE IF EXISTS subscription CASCADE`;
    await db`ALTER TABLE tenant DROP COLUMN IF EXISTS stripe_customer_id`;
  },
};

export default migration;
