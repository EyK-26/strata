import { describe, expect, test } from "bun:test";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import CommentRepository from "../../src/modules/comment/repository";
import SearchService from "../../src/modules/search/service";
import TaskRepository from "../../src/modules/task/repository";
import { defaultTestTenant } from "./testHelpers";

function createSearchService(): SearchService {
  return new SearchService(new TaskRepository(), new CommentRepository());
}

describe("SearchService", () => {
  test("finds seeded task titles by full-text query", async () => {
    const service = createSearchService();

    await runWithTenantDatabase(defaultTestTenant, async () => {
      const results = await service.search("registry");
      expect(results.some((result) => result.type === "task")).toBe(true);
    });
  });

  test("returns an empty array when nothing matches", async () => {
    const service = createSearchService();

    await runWithTenantDatabase(defaultTestTenant, async () => {
      const results = await service.search("zzzz-no-match-zzzz", 5);
      expect(results).toEqual([]);
    });
  });
});
