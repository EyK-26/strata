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

export type { PaginatedResult, PaginationMeta };
export { buildPaginationMeta };
