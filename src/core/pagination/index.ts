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
