import type { DatabaseSession, TransactionSession } from "../database/session";
import type { EstablishedDatabasePolicy, ScopedPolicy } from "./scopedDatabasePolicy";
export function runWithScopedTenantTransaction<T>(
  selected: DatabaseSession | TransactionSession,
  policy: ScopedPolicy,
  established: EstablishedDatabasePolicy,
  callback: (child: TransactionSession) => T | Promise<T>,
): Promise<T> {
  return policy.run(selected, established, callback);
}
export function runWithMigrationBypass<T>(
  selected: DatabaseSession | TransactionSession,
  policy: ScopedPolicy,
  callback: (child: TransactionSession) => T | Promise<T>,
): Promise<T> {
  return policy.run(selected, { kind: "bypass" }, callback);
}
export function runWithMigrationBypassForIdentifier<T>(
  selected: DatabaseSession | TransactionSession,
  policy: ScopedPolicy,
  identifier: string | number,
  callback: (child: TransactionSession) => T | Promise<T>,
): Promise<T> {
  return policy.run(selected, { kind: "identifier", identifier }, callback);
}
