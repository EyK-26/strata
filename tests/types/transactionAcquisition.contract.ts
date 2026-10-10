/** Compiled against source and packed public exports; not executed. */
import {
  createTransactionAcquisitionMetrics,
  renderTransactionAcquisitionMetrics,
  type TransactionAcquisitionSnapshot,
  type TransactionOptions,
} from "@getstrata/core";
import { runInTransaction } from "@getstrata/core/database/transaction";

export async function transactionAcquisitionContract(): Promise<void> {
  const metrics = createTransactionAcquisitionMetrics();
  const snapshot: TransactionAcquisitionSnapshot = metrics.snapshot();
  const rendered: string = renderTransactionAcquisitionMetrics(snapshot);
  const options: TransactionOptions = {
    acquisitionSignal: AbortSignal.timeout(1000),
    acquisitionMetrics: metrics,
  };
  // @ts-expect-error Collector state belongs to the official factory, not arbitrary observation hooks.
  runInTransaction(async () => {}, { acquisitionMetrics: { snapshot: () => snapshot } });
  void rendered;
  const value: number = await runInTransaction(async () => 42, options);
  // @ts-expect-error Signal is explicit, never a numeric pseudo-timeout.
  runInTransaction(async () => {}, { acquisitionSignal: 1000 });
  // @ts-expect-error This is not cancellation of an admitted business transaction.
  runInTransaction(async () => {}, { signal: new AbortController().signal });
  void value;
}
