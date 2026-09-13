import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("release.yml quality gate", () => {
  test("HiroApp runtime is strata_app on compose, not the postgres service URL", async () => {
    const text = await readFile(join(import.meta.dir, "../../.github/workflows/release.yml"), "utf8");
    expect(text).toContain("docker compose up -d postgres redis --wait");
    expect(text).toContain(
      "DATABASE_URL: postgresql://postgres:dev-postgres-change-me@localhost:54329/bun_testing_test",
    );
    expect(text).toContain(
      "MIGRATION_DATABASE_URL: postgresql://postgres:dev-postgres-change-me@localhost:54329/hiroapp_test",
    );
    expect(text).toContain(
      "APP_DATABASE_URL: postgresql://strata_app:dev-strata-app-change-me@localhost:54329/hiroapp_test",
    );
    expect(text).not.toMatch(/APP_DATABASE_URL: postgresql:\/\/postgres:/);
    expect(text).not.toContain("@localhost:5432/bun_testing");
    expect(text).not.toContain("@localhost:5432/hiroapp_test");
  });
});
