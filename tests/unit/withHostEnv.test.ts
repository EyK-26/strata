import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("with-host-env.sh", () => {
  test("reads scripts/with-host-env.sh text: APP_DATABASE_URL strata_app@hiroapp_test, fixture DATABASE_URL postgres@bun_testing_test", async () => {
    const text = await readFile(join(import.meta.dir, "../../scripts/with-host-env.sh"), "utf8");
    expect(text).toContain("postgresql://strata_app:");
    expect(text).toContain("@localhost:54329/hiroapp_test");
    expect(text).toContain("@localhost:54329/bun_testing_test");
    expect(text).toContain("Fixture DATABASE_URL is fixture admin");
    expect(text).toContain("It is not HiroApp HTTP");
    expect(text).not.toMatch(/Fixture DATABASE_URL is HiroApp HTTP/i);
  });
});
