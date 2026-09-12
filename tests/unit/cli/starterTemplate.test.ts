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

    expect(packageJson.dependencies["@getstrata/cli"]).toBe("^1.1.0");
    expect(packageJson.dependencies["@getstrata/core"]).toBe("^1.1.0");
    expect(packageJson.dependencies["@getstrata/bootstrap"]).toBe("^1.1.0");
    expect(packageJson.dependencies.eta).toBe("^4.6.0");
    expect(packageJson.dependencies.mysql2).toBeUndefined();
    expect(packageJson.scripts.dev).toBe("strata dev");
    expect(packageJson.scripts.start).toBe("strata start");
    expect(packageJson.scripts["db:migrate"]).toBe("strata migrate");
    expect(packageJson.scripts["db:fresh"]).toBe("strata migrate:fresh");
  });

  test("create-strata next steps use bun run scripts, not a global strata", async () => {
    const source = await readFile(
      join(process.cwd(), "packages/strata-starter/src/generate.ts"),
      "utf8",
    );
    // `strata` lands in the app's node_modules/.bin, not on PATH, so the
    // printed steps have to go through the package.json scripts.
    expect(source).toContain("bun run db:migrate");
    expect(source).toContain("bun run dev");
    expect(source).not.toContain('console.log("  strata migrate")');
    expect(source).not.toContain('console.log("  strata dev\\n")');
  });
});
