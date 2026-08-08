import type { Migration } from "./types";

const migration: Migration = {
  name: "0012_create_webhooks",
  async up(db) {
    await db`
      CREATE TABLE IF NOT EXISTS webhook (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER REFERENCES organization(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        events JSONB NOT NULL DEFAULT '["*"]'::jsonb,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`
      CREATE TABLE IF NOT EXISTS webhook_delivery (
        id SERIAL PRIMARY KEY,
        webhook_id INTEGER NOT NULL REFERENCES webhook(id) ON DELETE CASCADE,
        event TEXT NOT NULL,
        payload JSONB NOT NULL,
        response_status INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
  },
  async down(db) {
    await db`DROP TABLE IF EXISTS webhook_delivery CASCADE`;
    await db`DROP TABLE IF EXISTS webhook CASCADE`;
  },
};

export default migration;
