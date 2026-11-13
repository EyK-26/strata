/** Compile-time worker source contract; not executed. */
import { type OutboxWorkerOptions, runOutboxWorkerCommand } from "@getstrata/cli/outboxWorker";
import type { Application } from "@getstrata/core/contracts/application";
import type { OutboxWorkerTransport } from "@getstrata/core/events/outbox";
export function configuredOutboxWorkerContract(
  application: Application,
  outboxWorker: OutboxWorkerTransport,
): void {
  const options: OutboxWorkerOptions = { boot: () => ({ application, outboxWorker }) };
  void runOutboxWorkerCommand(options);
  void runOutboxWorkerCommand({ boot: async () => ({ application, outboxWorker }) });
  // @ts-expect-error A boot must return the original application and its worker.
  void runOutboxWorkerCommand({ boot: () => {} });
  // @ts-expect-error A coordinator/listener list cannot replace the registered worker.
  void runOutboxWorkerCommand({ listeners: [], boot: () => ({ application, outboxWorker }) });
  // @ts-expect-error Parallel cleanup callbacks are no longer supported.
  void runOutboxWorkerCommand({ close: () => {}, boot: () => ({ application, outboxWorker }) });
  // @ts-expect-error The worker's actual typed transport is required.
  void runOutboxWorkerCommand({ boot: () => ({ application, outboxWorker: { start: "run" } }) });
  // @ts-expect-error Worker configuration cannot be omitted from a successful boot.
  void runOutboxWorkerCommand({ boot: () => ({ application }) });
}
