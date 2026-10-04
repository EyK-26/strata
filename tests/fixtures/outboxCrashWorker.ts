import { SQL } from "bun";
import type { SqlDatabaseConnection } from "../../src/core/database/baseRepository";
import { registerDefaultDatabasePool } from "../../src/core/database/defaultConnection";
import { SqlOutbox } from "../../src/core/events/outbox";

const pool = new SQL({ url: process.env.OUTBOX_TEST_DATABASE_URL, max: 5 });
const adminUrl = process.env.OUTBOX_TEST_ADMIN_URL;
if (!adminUrl) throw new Error("Dedicated test admin URL required.");
const admin = new SQL(adminUrl);
registerDefaultDatabasePool(pool as unknown as SqlDatabaseConnection);
process.env.TENANCY_DRIVER = "rls";
const outbox = new SqlOutbox({
  leaseMs: 300,
  resolveTenant: async () => ({ id: 101, slug: "outbox", plan: "free", region: "eu" as const }),
  listeners: [
    {
      name: "effect",
      event: "order",
      handle: async (event) => {
        await admin.unsafe("INSERT INTO effects VALUES ($1, $2) ON CONFLICT DO NOTHING", [
          event.id,
          101,
        ]);
        console.log("EXTERNAL_EFFECT_COMMITTED");
        await new Promise<void>(() => {});
      },
    },
  ],
});
await outbox.processNext();
