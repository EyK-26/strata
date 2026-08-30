import { describe, expect, test } from "bun:test";
import { htmlReportsHomePath, htmlReportsWantsAll } from "../../src/modules/report/listScope";

describe("htmlReportsWantsAll", () => {
  test("is false without a request or all=1", () => {
    expect(htmlReportsWantsAll()).toBe(false);
    expect(htmlReportsWantsAll(new Request("http://example.test/reports"))).toBe(false);
    expect(htmlReportsWantsAll(new Request("http://example.test/reports?all="))).toBe(false);
  });

  test("is true when all=1", () => {
    expect(htmlReportsWantsAll(new Request("http://example.test/reports?all=1"))).toBe(true);
  });
});

describe("htmlReportsHomePath", () => {
  test("returns null for the tenant summary", () => {
    expect(htmlReportsHomePath({})).toBeNull();
    expect(htmlReportsHomePath({ all: true, organizationId: 1 })).toBeNull();
  });

  test("returns the current-team report path", () => {
    expect(htmlReportsHomePath({ organizationId: 2 })).toBe("/reports/organizations/2");
  });
});
