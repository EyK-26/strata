import { describe, expect, test } from "bun:test";
import {
  buildPaginationMeta,
  paginatedResponse,
  parsePaginationQuery,
} from "@getstrata/core/http/pagination";

describe("parsePaginationQuery", () => {
  test("defaults page and per_page when query params are omitted", () => {
    expect(parsePaginationQuery()).toEqual({ page: 1, perPage: 15 });
  });

  test("parses page and per_page from the request URL", () => {
    const request = new Request("http://example.test/organizations?page=2&per_page=10");

    expect(parsePaginationQuery(request)).toEqual({ page: 2, perPage: 10 });
  });

  test("rejects invalid page values", () => {
    const request = new Request("http://example.test/organizations?page=0");

    expect(() => parsePaginationQuery(request)).toThrow(
      'Invalid query parameter "page". Expected a positive integer.',
    );
  });

  test("rejects per_page above the configured maximum", () => {
    const request = new Request("http://example.test/organizations?per_page=500");

    expect(() => parsePaginationQuery(request)).toThrow(
      'Invalid query parameter "per_page". Maximum allowed value is 100.',
    );
  });
});

describe("buildPaginationMeta", () => {
  test("computes last_page from total and per_page", () => {
    expect(buildPaginationMeta({ page: 2, perPage: 10, total: 25 })).toEqual({
      page: 2,
      per_page: 10,
      total: 25,
      last_page: 3,
    });
  });

  test("never returns last_page below 1 even when total is zero", () => {
    expect(buildPaginationMeta({ page: 1, perPage: 15, total: 0 })).toEqual({
      page: 1,
      per_page: 15,
      total: 0,
      last_page: 1,
    });
  });
});

describe("paginatedResponse", () => {
  test("returns a data/meta JSON payload", async () => {
    const response = paginatedResponse(
      [{ id: 1 }],
      buildPaginationMeta({ page: 1, perPage: 15, total: 1 }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [{ id: 1 }],
      meta: {
        page: 1,
        per_page: 15,
        total: 1,
        last_page: 1,
      },
    });
  });
});
