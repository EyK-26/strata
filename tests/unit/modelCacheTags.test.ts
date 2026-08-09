import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  cacheTagsForModelWrite,
  discoverModelTableNames,
} from "@getstrata/bootstrap/cache/modelCacheTags";
import {
  configureModulesDirectory,
  ensureModulesLoaded,
  resetDiscoverModulesForTests,
} from "@getstrata/bootstrap/discoverModules";
import { CACHE_TAGS } from "@getstrata/core/cache/tags";

const FIXTURE_MODULES = join(import.meta.dir, "../fixtures/discover-modules");
const EMPTY_MODULES = join(import.meta.dir, "../fixtures/empty-modules");

beforeAll(async () => {
  resetDiscoverModulesForTests();
  configureModulesDirectory(FIXTURE_MODULES);
  await ensureModulesLoaded();
});

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

  test("returns no tags for audit log writes", () => {
    expect(cacheTagsForModelWrite("audit_log", "created")).toEqual([]);
  });
});

describe("discoverModelTableNames", () => {
  test("discovers model tables from module metadata", () => {
    expect(discoverModelTableNames()).toEqual(["organization", "audit_log"]);
  });

  test("returns an empty list when no modules expose tableName", async () => {
    resetDiscoverModulesForTests();
    configureModulesDirectory(EMPTY_MODULES);
    await ensureModulesLoaded();
    expect(discoverModelTableNames()).toEqual([]);
    resetDiscoverModulesForTests();
    configureModulesDirectory(FIXTURE_MODULES);
    await ensureModulesLoaded();
  });
});
