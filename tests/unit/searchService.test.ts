import { describe, expect, test } from "bun:test";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import CommentRepository from "../../src/modules/comment/repository";
import OrganizationRepository from "../../src/modules/organization/repository";
import ProjectRepository from "../../src/modules/project/repository";
import SearchService from "../../src/modules/search/service";
import TaskRepository from "../../src/modules/task/repository";
import { defaultTestTenant } from "./testHelpers";

function createSearchService(): SearchService {
  return new SearchService(
    new TaskRepository(),
    new CommentRepository(),
    new OrganizationRepository(),
    new ProjectRepository(),
  );
}

describe("SearchService", () => {
  test("finds seeded task titles by full-text query", async () => {
    const service = createSearchService();

    await runWithTenantDatabase(defaultTestTenant, async () => {
      const results = await service.search("registry");
      expect(results.some((result) => result.type === "task")).toBe(true);
    });
  });

  test("finds seeded projects and organizations by name", async () => {
    const service = createSearchService();

    await runWithTenantDatabase(defaultTestTenant, async () => {
      const projects = await service.search("platform");
      const organizations = await service.search("acme");

      expect(projects.some((result) => result.type === "project")).toBe(true);
      expect(organizations.some((result) => result.type === "organization")).toBe(true);
    });
  });

  test("finds seeded organizations by slug", async () => {
    const service = createSearchService();

    await runWithTenantDatabase(defaultTestTenant, async () => {
      const results = await service.search("acme-labs");

      expect(results.some((result) => result.type === "organization" && result.id === 1)).toBe(
        true,
      );
    });
  });

  test("returns an empty array when nothing matches", async () => {
    const service = createSearchService();

    await runWithTenantDatabase(defaultTestTenant, async () => {
      const results = await service.search("zzzz-no-match-zzzz", { limit: 5 });
      expect(results).toEqual([]);
    });
  });

  test("scopes hits to a requested organization", async () => {
    const service = createSearchService();

    await runWithTenantDatabase(defaultTestTenant, async () => {
      const orbital = await service.search("docking", { organizationId: 2 });
      const acme = await service.search("docking", { organizationId: 1 });
      const collision = await service.search("collision", { organizationId: 2 });
      const otherOrg = await service.search("acme-labs", { organizationId: 2 });

      expect(orbital.some((result) => result.type === "project" && result.id === 3)).toBe(true);
      expect(acme).toEqual([]);
      expect(collision.some((result) => result.type === "comment")).toBe(true);
      expect(otherOrg).toEqual([]);
    });
  });
});
