import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenApiGenerateCommand } from "../../../packages/strata-cli/src/openapi";
import { captureConsole, repoRoot } from "./helpers";

const tempDirectories: string[] = [];

afterEach(async () => {
  process.chdir(repoRoot);

  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

async function withTempWorkspace(run: (workspace: string) => Promise<void>): Promise<void> {
  const created = await mkdtemp(join(tmpdir(), "strata-openapi-generate-"));
  tempDirectories.push(created);
  const workspace = await realpath(created);
  process.chdir(workspace);
  await run(workspace);
}

describe("createOpenApiGenerateCommand", () => {
  test("creates docs/ when the output directory is missing", async () => {
    await withTempWorkspace(async (workspace) => {
      expect(existsSync(join(workspace, "docs"))).toBe(false);

      const command = createOpenApiGenerateCommand(async () => ({ routes: {} }));
      const output = captureConsole();

      try {
        await command();
      } finally {
        output.restore();
      }

      const jsonPath = join(workspace, "docs/openapi.json");
      const contents = await readFile(jsonPath, "utf8");
      expect(contents).toContain('"openapi"');
      expect(output.logs[0]).toMatch(
        /^OpenAPI spec written to .*docs\/openapi\.json \(\d+ routes\)\.$/,
      );
    });
  });

  test("still writes docs/openapi.json when docs/ already exists", async () => {
    await withTempWorkspace(async (workspace) => {
      await mkdir(join(workspace, "docs"), { recursive: true });

      const command = createOpenApiGenerateCommand(async () => ({ routes: {} }));
      const output = captureConsole();

      try {
        await command();
      } finally {
        output.restore();
      }

      expect(existsSync(join(workspace, "docs/openapi.json"))).toBe(true);
    });
  });
});
