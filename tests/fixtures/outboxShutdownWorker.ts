import { runOutboxWorkerCommand } from "@getstrata/cli/outboxWorker";
import { bindDatabaseConnection } from "@getstrata/core/database/boundConnection";
import { useSqlDialect } from "@getstrata/core/database/dialect";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { runInTransaction } from "@getstrata/core/database/transaction";
import {
  createOutboxMigration,
  type DurableListener,
  SqlOutbox,
} from "@getstrata/core/events/outbox";

process.env.TENANCY_DRIVER = "none";
useSqlDialect("sqlite");
const db = createSqliteConnection(":memory:");
bindDatabaseConnection(db);
const listeners: DurableListener[] = [
  {
    name: "shutdown-regression",
    event: "test.created",
    handle: async (_event, { signal }) => {
      console.log("ACTIVE");
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      await Bun.sleep(30);
      console.log("FINISHED");
    },
  },
];
await runOutboxWorkerCommand({
  listeners,
  boot: async () => {
    await createOutboxMigration("outbox", "sqlite").up(db);
    const publisher = new SqlOutbox({ listeners });
    await runInTransaction(() => publisher.publish("test.created", {}));
  },
  drain: async () => {
    const [delivery] = await db.unsafe<{ status: string }>(
      "SELECT status FROM strata_outbox_delivery",
    );
    if (!delivery || delivery.status === "completed")
      throw new Error("Aborted delivery must remain recoverable");
    console.log("DRAINED");
  },
  flush: () => {
    console.log("FLUSHED");
  },
  close: () => {
    db.close();
    console.log("CLOSED");
  },
});
