import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("starter template CLI", () => {
  test("depends on @getstrata/cli and uses strata scripts", async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "packages/strata-starter/templates/package.json"), "utf8"),
    ) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };

    expect(packageJson.dependencies["@getstrata/cli"]).toBe("^0.2.0");
    expect(packageJson.dependencies["@getstrata/core"]).toBe("^0.7.5");
    expect(packageJson.dependencies["@getstrata/bootstrap"]).toBe("^0.4.3");
    expect(packageJson.scripts.dev).toBe("strata dev");
    expect(packageJson.scripts.start).toBe("strata start");
    expect(packageJson.scripts["db:migrate"]).toBe("strata migrate");
    expect(packageJson.scripts["db:fresh"]).toBe("strata migrate:fresh");
  });

  test("create-strata next steps use strata commands", async () => {
    const source = await readFile(
      join(process.cwd(), "packages/strata-starter/src/generate.ts"),
      "utf8",
    );
    expect(source).toContain("strata migrate");
    expect(source).toContain("strata dev");
    expect(source).not.toContain("bun run db:migrate");
    expect(source).not.toContain("bun run dev");
  });
});
