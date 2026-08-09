import type { SQL } from "bun";
import type { MigrationDatabase } from "../../framework/public-api.ts";

function asMigrationDatabase(db: SQL): MigrationDatabase {
  return {
    unsafe<T = unknown>(query: string, params: readonly unknown[] = []) {
      return db.unsafe(query, params as never[]) as Promise<T[]>;
    },
  };
}

export { asMigrationDatabase };
