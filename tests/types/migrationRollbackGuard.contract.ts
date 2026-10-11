import {
  guardMigrationRollback,
  type MigrationRollbackGuard,
} from "@getstrata/core/database/migrations";
import type { Migration, MigrationDownContext } from "@getstrata/core/database/migrations/types";

const guard: MigrationRollbackGuard = { hasHistory: async () => true, message: "Retain purchases" };
const result: Promise<void> = guardMigrationRollback(undefined, guard);
void result;
const migration: Migration = {
  name: "protected",
  async up() {},
  async down(db, context) {
    await guardMigrationRollback(context, {
      hasHistory: async () => (await db.unsafe("SELECT id FROM history LIMIT 1")).length > 0,
      message: "Retain purchases",
    });
  },
};
void migration;
// @ts-expect-error The predicate must return a boolean, not a count.
void guardMigrationRollback(undefined, { hasHistory: () => 1, message: "History" });
// @ts-expect-error Refusal text is required.
void guardMigrationRollback(undefined, { hasHistory: () => true });
// @ts-expect-error Reset context is a closed contract.
const invalidContext: MigrationDownContext = { operation: "rollback" };
void invalidContext;
