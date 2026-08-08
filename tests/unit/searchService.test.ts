import { beforeAll, describe, expect, test } from "bun:test";
import SearchService from "../../src/modules/search/service";

beforeAll(async () => {
  const { freshDatabase } = await import("../../src/db/migrations/runner");
  await freshDatabase({ seed: true });
});

describe("SearchService", () => {
  test("finds seeded task titles by full-text query", async () => {
    const service = new SearchService();
    const results = await service.search("registry");

    expect(results.some((result) => result.type === "task")).toBe(true);
  });
});
