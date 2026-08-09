import { describe, expect, test } from "bun:test";
import { PreconditionFailedError } from "../../src/core/errors/http";
import {
  applyConditionalGet,
  assertIfMatch,
  computeEtagFromJson,
  etagFromResource,
  ifMatchSatisfied,
  ifNoneMatchSatisfied,
} from "../../src/core/http/etag";

describe("etagFromResource", () => {
  test("uses updated_at when present", () => {
    const first = etagFromResource({
      id: 1,
      updated_at: "2026-01-01T00:00:00.000Z",
      created_at: "2025-01-01T00:00:00.000Z",
    });
    const second = etagFromResource({
      id: 1,
      updated_at: "2026-02-01T00:00:00.000Z",
      created_at: "2025-01-01T00:00:00.000Z",
    });

    expect(first).toMatch(/^W\/"/);
    expect(first).not.toBe(second);
  });

  test("falls back to created_at when updated_at is missing", () => {
    const etag = etagFromResource({ id: 5, created_at: "2025-06-01T00:00:00.000Z" });

    expect(etag).toMatch(/^W\/"/);
  });
});

describe("computeEtagFromJson", () => {
  test("returns stable weak etags for the same payload", () => {
    const payload = { data: [{ id: 1 }], meta: { page: 1 } };
    expect(computeEtagFromJson(payload)).toBe(computeEtagFromJson(payload));
  });
});

describe("ifNoneMatchSatisfied", () => {
  test("matches quoted etag values", () => {
    const etag = 'W/"abc123"';
    const request = new Request("http://example.test/items/1", {
      headers: { "if-none-match": etag },
    });

    expect(ifNoneMatchSatisfied(request, etag)).toBe(true);
  });

  test("matches wildcard", () => {
    const request = new Request("http://example.test/items/1", {
      headers: { "if-none-match": "*" },
    });

    expect(ifNoneMatchSatisfied(request, 'W/"anything"')).toBe(true);
  });
});

describe("ifMatchSatisfied", () => {
  test("returns false when header is absent", () => {
    const request = new Request("http://example.test/items/1");

    expect(ifMatchSatisfied(request, 'W/"abc"')).toBe(false);
  });

  test("matches one of several etags", () => {
    const etag = 'W/"match-me"';
    const request = new Request("http://example.test/items/1", {
      headers: { "if-match": 'W/"other", W/"match-me"' },
    });

    expect(ifMatchSatisfied(request, etag)).toBe(true);
  });
});

describe("assertIfMatch", () => {
  test("allows missing header by default", () => {
    const request = new Request("http://example.test/items/1");

    expect(() => assertIfMatch(request, 'W/"abc"')).not.toThrow();
  });

  test("throws when etag does not match", () => {
    const request = new Request("http://example.test/items/1", {
      headers: { "if-match": 'W/"stale"' },
    });

    expect(() => assertIfMatch(request, 'W/"current"')).toThrow(PreconditionFailedError);
  });

  test("requires header when configured", () => {
    const request = new Request("http://example.test/items/1");

    expect(() => assertIfMatch(request, 'W/"current"', { required: true })).toThrow(
      PreconditionFailedError,
    );
  });
});

describe("applyConditionalGet", () => {
  test("returns 304 when If-None-Match matches", async () => {
    const etag = etagFromResource({ id: 1, updated_at: "2026-01-01T00:00:00.000Z" });
    const request = new Request("http://example.test/items/1", {
      headers: { "if-none-match": etag },
    });
    const original = Response.json({ id: 1 });

    const response = applyConditionalGet(request, original, etag);

    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(etag);
    expect(await response.text()).toBe("");
  });

  test("adds ETag header to full responses", () => {
    const etag = etagFromResource({ id: 1, updated_at: "2026-01-01T00:00:00.000Z" });
    const request = new Request("http://example.test/items/1");
    const original = Response.json({ id: 1 });

    const response = applyConditionalGet(request, original, etag);

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(etag);
  });
});
