import type { QueryOrder } from "./types.ts";

interface TableDefinition<
  TEntity,
  PrimaryKey extends keyof TEntity & string = keyof TEntity & string,
> {
  name: string;
  primaryKey: PrimaryKey;
  columns: readonly (keyof TEntity & string)[];
  defaultOrderBy?: QueryOrder<TEntity> | QueryOrder<TEntity>[];
}

function defineTable<
  TEntity,
  PrimaryKey extends keyof TEntity & string = keyof TEntity & string,
>(
  definition: TableDefinition<TEntity, PrimaryKey>,
): TableDefinition<TEntity, PrimaryKey> {
  return definition;
}

export { defineTable };
export type { TableDefinition };
