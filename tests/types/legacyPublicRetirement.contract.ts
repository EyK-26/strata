/** Copied into installed package checks; no top-level database or event work. */
import * as core from "@getstrata/core";
import type {
  DatabaseSession,
  TransactionOptions,
  TransactionSession,
} from "@getstrata/core/database/session";
// @ts-expect-error The ambient transaction subpath is intentionally no longer published.
import { runInTransaction as retiredTransaction } from "@getstrata/core/database/transaction";
import type { EventListener } from "@getstrata/core/events";
import * as events from "@getstrata/core/events";

export async function explicitPublicOwnershipContract(
  database: DatabaseSession,
  transaction: TransactionSession,
): Promise<void> {
  const bus: events.EventBus = new core.EventBus();
  const listener: EventListener = async (_payload) => {};
  const off: () => void = bus.listen(events.modelEventName("orders", "created"), listener);
  off();
  const options: TransactionOptions = { acquisitionSignal: new AbortController().signal };
  const value: number = await database.transaction(async (selected) => {
    selected.afterCommit(() => {});
    selected.requestRollback();
    return 42;
  }, options);
  transaction.afterCommit(async () => {});
  transaction.requestRollback();
  // @ts-expect-error No ambient root callback owner.
  core.afterCommit(() => {});
  // @ts-expect-error No ambient root transaction owner.
  core.runInTransaction(async () => {});
  // @ts-expect-error No ambient root rollback request.
  core.requestTransactionRollback();
  // @ts-expect-error No process-global dispatcher.
  core.eventBus;
  // @ts-expect-error No ambient event dispatcher.
  events.dispatchModelEvent("orders.created", {});
  // @ts-expect-error No mutable ambient deferred batch.
  events.runWithDeferredModelEvents(async () => {});
  // @ts-expect-error No process-global dispatcher accessor.
  events.readSharedEventBus();
  // @ts-expect-error The execution root still cannot register transaction observers.
  database.afterCommit(() => {});
  void value;
  void retiredTransaction;
}
