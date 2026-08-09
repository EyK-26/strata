import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function readJson(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(process.cwd(), relativePath), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("spa-react frontend toolchain", () => {
  test("spa-react scaffold uses Bun instead of Vite", async () => {
    const packageJson = await readJson("templates/scaffold/spa-react/frontend/package.json");
    const scripts = packageJson.scripts as Record<string, string>;
    const allDependencies = {
      ...(packageJson.dependencies as Record<string, string>),
      ...(packageJson.devDependencies as Record<string, string>),
    };

    expect(scripts.build).toContain("build.ts");
    expect(scripts.dev).toContain("dev-server.ts");
    expect(allDependencies.vite).toBeUndefined();
  });
});
