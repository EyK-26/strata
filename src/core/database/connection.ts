import type { DatabaseConnection } from "./baseRepository.ts";

type UnsafeQueryable = {
  unsafe<T>(query: string, params?: readonly unknown[]): Promise<T[]>;
};

function createDatabaseConnection(source: UnsafeQueryable): DatabaseConnection {
  return {
    async unsafe<T>(query: string, params: readonly unknown[] = []) {
      return await source.unsafe<T>(query, params);
    },
  };
}

export { createDatabaseConnection };
export type { UnsafeQueryable };
