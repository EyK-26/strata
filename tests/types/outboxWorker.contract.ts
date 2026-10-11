/** Compile-time worker source contract; not executed. */
import { type OutboxWorkerOptions, runOutboxWorkerCommand } from "@getstrata/cli/outboxWorker";
import { SqlOutbox } from "@getstrata/core/events/outbox";
export function configuredOutboxWorkerContract(): void {
  const outbox = new SqlOutbox({ listeners: [], resolveTenant: async () => null, leaseMs: 1000 });
  const options: OutboxWorkerOptions = { outbox, boot: () => {} };
  void runOutboxWorkerCommand(options);
  void runOutboxWorkerCommand({ listeners: [], boot: () => {} });
  // @ts-expect-error Sources are mutually exclusive.
  void runOutboxWorkerCommand({ outbox, listeners: [], boot: () => {} });
  // @ts-expect-error A worker source is required.
  void runOutboxWorkerCommand({ boot: () => {} });
  // @ts-expect-error Configured workers must implement the typed work contract.
  void runOutboxWorkerCommand({ outbox: { work: "run" }, boot: () => {} });
}
