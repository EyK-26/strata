import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeModuleCommand } from "../../../packages/strata-cli/src/scaffold/makeModule";
import { renderModuleScaffold } from "../../../packages/strata-cli/src/scaffold/renderModule";
import baselines from "../../fixtures/scaffolds/module-rendering.sha256.json";
import { captureConsole } from "./helpers";

for (const { profile, files: expected } of baselines) {
  test(`module rendering preserves every pre-extraction byte: ${profile.name}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "strata-module-rendering-"));
    const previousCwd = process.cwd();
    const output = captureConsole();
    try {
      await mkdir(join(directory, "src/models"), { recursive: true });
      await writeFile(join(directory, "src/models/register.ts"), "// Existing model registry\n");
      if (profile.views) await mkdir(join(directory, "views"));
      process.chdir(directory);
      await makeModuleCommand(...(profile.withWeb ? ["--with-web"] : []), profile.name);
      const actual: Record<string, unknown> = {};
      async function visit(path: string): Promise<void> {
        for (const item of await readdir(path, { withFileTypes: true })) {
          const full = join(path, item.name);
          if (item.isDirectory()) await visit(full);
          else
            actual[full.slice(directory.length + 1)] = createHash("sha256")
              .update(await readFile(full))
              .digest("hex");
        }
      }
      await visit(directory);
      expect(actual).toEqual(expected);
    } finally {
      output.restore();
      process.chdir(previousCwd);
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("rendering produces independent in-memory manifests without writing to disk", () => {
  const options = {
    moduleSlug: "item",
    moduleName: "Item",
    moduleIdentifier: "item",
    withWeb: true,
  };
  const first = renderModuleScaffold(options);
  const originalController = first.files.get("controller.ts");
  first.files.set("controller.ts", "caller-edited");
  const next = renderModuleScaffold(options);
  expect(next.files.get("controller.ts")).toBe(originalController);
  expect(next.webFiles.has("webController.ts")).toBe(true);
  expect(next.viewFiles.has("index.eta")).toBe(true);
});
