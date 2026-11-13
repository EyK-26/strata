/** Compiled against source and packed public exports; not executed. */
import {
  createTransactionAcquisitionMetrics,
  renderTransactionAcquisitionMetrics,
  type TransactionAcquisitionSnapshot,
  type TransactionOptions,
} from "@getstrata/core";
import type { DatabaseSession } from "@getstrata/core/database/session";

export async function transactionAcquisitionContract(database: DatabaseSession): Promise<void> {
  const metrics = createTransactionAcquisitionMetrics();
  const snapshot: TransactionAcquisitionSnapshot = metrics.snapshot();
  const rendered: string = renderTransactionAcquisitionMetrics(snapshot);
  const options: TransactionOptions = {
    acquisitionSignal: AbortSignal.timeout(1000),
    acquisitionMetrics: metrics,
  };
  // @ts-expect-error Collector state belongs to the official factory, not arbitrary observation hooks.
  database.transaction(async () => {}, { acquisitionMetrics: { snapshot: () => snapshot } });
  void rendered;
  const value: number = await database.transaction(async () => 42, options);
  // @ts-expect-error Signal is explicit, never a numeric pseudo-timeout.
  database.transaction(async () => {}, { acquisitionSignal: 1000 });
  // @ts-expect-error This is not cancellation of an admitted business transaction.
  database.transaction(async () => {}, { signal: new AbortController().signal });
  void value;
}
