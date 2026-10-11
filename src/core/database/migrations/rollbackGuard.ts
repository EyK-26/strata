import type { MigrationDownContext } from "./types.ts";

interface MigrationRollbackGuard {
  /** Application-owned history check. It is not evaluated during an explicit fresh reset. */
  hasHistory(): boolean | Promise<boolean>;
  message: string;
}

/** Await before destructive DDL. Predicate failures propagate; ordinary rollback remains guarded. */
async function guardMigrationRollback(
  context: MigrationDownContext | undefined,
  guard: MigrationRollbackGuard,
): Promise<void> {
  if (context?.operation === "fresh") return;
  if (await guard.hasHistory()) throw new Error(guard.message);
}

export type { MigrationRollbackGuard };
export { guardMigrationRollback };
