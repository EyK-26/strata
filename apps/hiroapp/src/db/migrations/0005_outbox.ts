import { createOutboxMigration } from "@getstrata/core/events/outbox";

export default createOutboxMigration("0005_outbox", "pgsql", { rls: true });
