import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  cacheTagsForModelWrite,
  discoverModelTableNames,
} from "@getstrata/bootstrap/cache/modelCacheTags";
import { ensureModulesLoaded } from "@getstrata/bootstrap/discoverModules";
import { CACHE_TAGS } from "@getstrata/core/cache/tags";

const FIXTURE_MODULES = join(import.meta.dir, "../fixtures/discover-modules");
const EMPTY_MODULES = join(import.meta.dir, "../fixtures/empty-modules");

const modules = await ensureModulesLoaded({ modulesDir: FIXTURE_MODULES });

describe("cacheTagsForModelWrite", () => {
  test("maps organization writes to organization and report tags", () => {
    expect(cacheTagsForModelWrite("organization", "created", modules)).toEqual([
      CACHE_TAGS.organizations,
      CACHE_TAGS.reports,
    ]);
  });

  test("adds project tags when an organization is deleted", () => {
    expect(cacheTagsForModelWrite("organization", "deleted", modules)).toEqual([
      CACHE_TAGS.organizations,
      CACHE_TAGS.reports,
      CACHE_TAGS.projects,
    ]);
  });

  test("falls back to a pluralized table tag for unknown models", () => {
    expect(cacheTagsForModelWrite("invoice", "updated", modules)).toEqual(["invoices"]);
    expect(cacheTagsForModelWrite("notes", "updated", [])).toEqual(["notes"]);
  });

  test("returns no tags for audit log writes", () => {
    expect(cacheTagsForModelWrite("audit_log", "created", modules)).toEqual([]);
  });
});

describe("discoverModelTableNames", () => {
  test("discovers model tables from module metadata", () => {
    expect(discoverModelTableNames(modules)).toEqual(["organization", "audit_log"]);
  });

  test("returns an empty list when no modules expose tableName", async () => {
    expect(
      discoverModelTableNames(await ensureModulesLoaded({ modulesDir: EMPTY_MODULES })),
    ).toEqual([]);
  });
});
