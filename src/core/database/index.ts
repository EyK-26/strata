export type { DatabaseConnection } from "./baseRepository.ts";
export { default as BaseRepository } from "./baseRepository.ts";
export { createDatabaseConnection } from "./connection.ts";
export { mapDatabaseError, withDatabaseErrorHandling } from "./errors.ts";
export {
  buildCountQuery,
  buildDeleteByIdQuery,
  buildGroupedCountQuery,
  buildInsertQuery,
  buildOrderByClause,
  buildProjectionQuery,
  buildQueryWhereClause,
  buildRestoreByIdQuery,
  buildSelectQuery,
  buildSoftDeleteByIdQuery,
  buildUpdateQuery,
  buildWhereClause,
  qualifyColumn,
  quoteIdentifier,
  resolveSoftDeleteColumn,
} from "./query.ts";
export type { BelongsToRelation, HasManyRelation } from "./relationships.ts";
export {
  belongsTo,
  hasMany,
  indexBelongsToRelation,
  indexHasManyRelation,
} from "./relationships.ts";
export type { TableDefinition } from "./table.ts";
export { defineTable } from "./table.ts";
export { runInTransaction } from "./transaction.ts";
export type {
  DatabaseComparable,
  DatabaseScalar,
  MutationValues,
  QueryFilterValue,
  QueryOperator,
  QueryOptions,
  QueryOrder,
  QueryWhere,
  UpdateValues,
} from "./types.ts";
