import { BadRequestError } from "../errors/http";
import { getQueryParams } from "./validation";
import {
  buildPaginationMeta,
  type PaginatedResult,
  type PaginationMeta,
} from "../pagination";

const DEFAULT_PER_PAGE = 15;
const MAX_PER_PAGE = 100;

interface PaginationQuery {
  page: number;
  perPage: number;
}

function parseRequiredPositiveIntQueryParam(
  params: URLSearchParams,
  name: string,
): number {
  const value = params.get(name);

  if (value === null || value.trim() === "") {
    throw new BadRequestError(
      `Invalid query parameter "${name}". Expected a positive integer.`,
    );
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestError(
      `Invalid query parameter "${name}". Expected a positive integer.`,
    );
  }

  return parsed;
}

function parsePaginationQuery(request?: Request): PaginationQuery {
  const params = getQueryParams(request);
  const pageParam = params.get("page");
  const perPageParam = params.get("per_page");

  const page =
    pageParam === null || pageParam.trim() === ""
      ? 1
      : parseRequiredPositiveIntQueryParam(params, "page");

  if (perPageParam === null || perPageParam.trim() === "") {
    return { page, perPage: DEFAULT_PER_PAGE };
  }

  const perPage = parseRequiredPositiveIntQueryParam(params, "per_page");

  if (perPage > MAX_PER_PAGE) {
    throw new BadRequestError(
      `Invalid query parameter "per_page". Maximum allowed value is ${MAX_PER_PAGE}.`,
    );
  }

  return { page, perPage };
}

function paginatedResponse<T>(
  data: T[],
  meta: PaginationMeta,
  init: ResponseInit = {},
): Response {
  return Response.json({ data, meta }, init);
}

export {
  DEFAULT_PER_PAGE,
  MAX_PER_PAGE,
  buildPaginationMeta,
  paginatedResponse,
  parsePaginationQuery,
};
export type { PaginatedResult, PaginationMeta, PaginationQuery };
