import type { KeysetCursor, KeysetOptions } from "../pagination/index.ts";
import type { TableDefinition } from "./table.ts";
import type { QueryWhere } from "./types.ts";
import type { WhereNode } from "./whereBuilder.ts";

const KEYSET_ALIAS_PREFIX = "__strata_keyset_";
function validateKeyset<TEntity extends object, PK extends keyof TEntity & string>(
  table: TableDefinition<TEntity, PK>,
  options: KeysetOptions<TEntity>,
): KeysetCursor["order"] {
  if (!Number.isInteger(options.perPage) || options.perPage < 1 || options.perPage > 1000)
    throw new RangeError("Keyset page size must be between 1 and 1000.");
  if (!Array.isArray(options.orderBy) || options.orderBy.length < 1 || options.orderBy.length > 8)
    throw new TypeError("Keyset ordering requires between 1 and 8 columns.");
  if (table.columns.some((column) => column.toLowerCase().startsWith(KEYSET_ALIAS_PREFIX)))
    throw new TypeError("Table columns conflict with reserved keyset aliases.");
  const seen = new Set<string>();
  const order = Array.from(options.orderBy).map(({ column, direction }) => {
    if (!table.columns.includes(column) || seen.has(column) || !["asc", "desc"].includes(direction))
      throw new TypeError("Invalid or duplicate keyset ordering column/direction.");
    seen.add(column);
    return { column, direction };
  });
  if (order.at(-1)?.column !== table.primaryKey)
    throw new TypeError("Keyset ordering must end with the table primary key.");
  if (options.cursor !== undefined) {
    const cursor = options.cursor;
    if (
      cursor?.version !== 1 ||
      !Array.isArray(cursor.order) ||
      cursor.order.length !== order.length ||
      !Array.isArray(cursor.values) ||
      cursor.values.length !== order.length ||
      Array.from(cursor.order).some(
        (item, i) =>
          !item || item.column !== order[i]?.column || item.direction !== order[i]?.direction,
      ) ||
      Array.from(cursor.values).some((value) => typeof value !== "string" || value.length > 4096)
    )
      throw new TypeError("Invalid keyset cursor or ordering mismatch.");
  }
  return order;
}
function keysetBoundary<TEntity extends object>(
  order: KeysetCursor["order"],
  cursor?: KeysetCursor,
): WhereNode<TEntity>[] {
  if (!cursor) return [];
  const branches = order.map((item, i): WhereNode<TEntity> => {
    const where: Record<string, unknown> = {};
    order.slice(0, i).forEach((prefix, j) => {
      where[prefix.column] = cursor.values[j];
    });
    where[item.column] = { [item.direction === "asc" ? "gt" : "lt"]: cursor.values[i] };
    return { kind: i === 0 ? "and" : "or", where: where as QueryWhere<TEntity> };
  });
  return [{ kind: "and", group: branches }];
}

export { KEYSET_ALIAS_PREFIX, keysetBoundary, validateKeyset };
