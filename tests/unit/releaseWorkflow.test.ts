import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("release.yml quality gate", () => {
  test("HiroApp runtime is strata_app on compose, not the postgres service URL", async () => {
    const text = await readFile(
      join(import.meta.dir, "../../.github/workflows/release.yml"),
      "utf8",
    );
    expect(text).toContain("docker compose up -d postgres mysql redis --wait");
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

test("publication depends on its own mandatory quality gate, not a separate CI run", async () => {
  const source = await readFile(
    join(import.meta.dir, "../../.github/workflows/release.yml"),
    "utf8",
  );
  const workflow = Bun.YAML.parse(source) as {
    jobs: Record<
      string,
      {
        needs?: unknown;
        "continue-on-error"?: boolean;
        steps: { name?: string; run?: string; if?: string; "continue-on-error"?: boolean }[];
      }
    >;
  };
  const publisher = workflow.jobs["publish-framework"];
  expect(publisher).toBeDefined();
  expect(publisher?.needs).toBeUndefined();
  expect(publisher?.["continue-on-error"]).not.toBe(true);
  const steps = publisher?.steps ?? [];
  const qualityIndex = steps.findIndex((step) => step.name === "Validate release quality gate");
  const dryRunIndex = steps.findIndex(
    (step) => step.run === "bun scripts/release-publication.ts dry-run",
  );
  const publishIndex = steps.findIndex(
    (step) => step.run === "bun scripts/release-publication.ts publish",
  );
  expect(qualityIndex).toBeGreaterThan(-1);
  expect(dryRunIndex).toBeGreaterThan(qualityIndex);
  expect(publishIndex).toBeGreaterThan(dryRunIndex);
  expect(steps[qualityIndex]?.run).toContain("bun run validate:ci");
  for (const index of [qualityIndex, dryRunIndex, publishIndex]) {
    expect(steps[index]?.if).toBeUndefined();
    expect(steps[index]?.["continue-on-error"]).not.toBe(true);
  }
  expect(source).not.toContain("verify-release-ci");
  expect(source).not.toContain("actions/workflows/ci.yml/runs");
});
