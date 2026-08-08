import { describe, expect, test } from "bun:test";
import {
  cacheTagsForModelWrite,
  discoverModelTableNames,
} from "../../src/core/cache/modelCacheTags";
import { CACHE_TAGS } from "../../src/core/cache/tags";

describe("cacheTagsForModelWrite", () => {
  test("maps organization writes to organization and report tags", () => {
    expect(cacheTagsForModelWrite("organization", "created")).toEqual([
      CACHE_TAGS.organizations,
      CACHE_TAGS.reports,
    ]);
  });

  test("adds project tags when an organization is deleted", () => {
    expect(cacheTagsForModelWrite("organization", "deleted")).toEqual([
      CACHE_TAGS.organizations,
      CACHE_TAGS.reports,
      CACHE_TAGS.projects,
    ]);
  });

  test("falls back to a pluralized table tag for unknown models", () => {
    expect(cacheTagsForModelWrite("invoice", "updated")).toEqual(["invoices"]);
  });
});

describe("discoverModelTableNames", () => {
  test("discovers WorkHub model tables from module metadata", () => {
    expect(discoverModelTableNames()).toEqual([
      "users",
      "organization",
      "project",
      "comment",
      "task",
      "audit_log",
      "webhook",
    ]);
  });
});
