import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("docker-compose.prod.yml", () => {
  test("app runtime DATABASE_URL is strata_app, not POSTGRES_USER", async () => {
    const text = await readFile(join(import.meta.dir, "../../docker-compose.prod.yml"), "utf8");
    expect(text).toContain("APP_DATABASE_URL: postgresql://strata_app:${STRATA_APP_PASSWORD");
    expect(text).toContain("STRATA_APP_PASSWORD:?STRATA_APP_PASSWORD is required");
    expect(text).toContain(
      "MIGRATION_DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-app}",
    );
    expect(text).toContain(
      "DATABASE_URL: postgresql://strata_app:${STRATA_APP_PASSWORD}@postgres:5432/${POSTGRES_DB:-app}",
    );
    expect(text).not.toMatch(/(?:^|\n)\s+DATABASE_URL: postgresql:\/\/\$\{POSTGRES_USER/);
    expect(text).toContain('"127.0.0.1:3000:3000"');
    expect(text).not.toContain("0.0.0.0:3000");
  });
});
