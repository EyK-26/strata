interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  last_page: number;
}

interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

interface CursorPaginationMeta<Cursor = unknown> {
  per_page: number;
  next_cursor: Cursor | null;
  prev_cursor: Cursor | null;
  has_more: boolean;
}

interface CursorPaginatedResult<T, Cursor = unknown> {
  data: T[];
  meta: CursorPaginationMeta<Cursor>;
}

function buildPaginationMeta(input: {
  page: number;
  perPage: number;
  total: number;
}): PaginationMeta {
  const lastPage = Math.max(1, Math.ceil(input.total / input.perPage));

  return {
    page: input.page,
    per_page: input.perPage,
    total: input.total,
    last_page: lastPage,
  };
}

export type { CursorPaginatedResult, CursorPaginationMeta, PaginatedResult, PaginationMeta };
export { buildPaginationMeta };

/** Ordering columns must be non-null scalar fields in the underlying schema. */
type KeysetColumn<TEntity> = {
  [K in keyof TEntity & string]: TEntity[K] extends string | number | bigint | Date ? K : never;
}[keyof TEntity & string];
interface KeysetCursor {
  version: 1;
  order: Array<{ column: string; direction: "asc" | "desc" }>;
  values: string[];
}
interface KeysetOptions<TEntity> {
  perPage: number;
  orderBy: readonly { column: KeysetColumn<TEntity>; direction: "asc" | "desc" }[];
  cursor?: KeysetCursor;
}

export type { KeysetColumn, KeysetCursor, KeysetOptions };
