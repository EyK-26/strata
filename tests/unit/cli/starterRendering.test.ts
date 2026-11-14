import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs.ts";
import historical from "../../fixtures/scaffolds/starter-rendering.sha256.json";
import baselines from "../../fixtures/scaffolds/starter-rendering-canonical.sha256.json";

for (const { name, args, files: expected } of baselines) {
  test(`starter rendering matches the canonical file inventory and every byte: ${name}`, async () => {
    const layers = layersFromFlags(parseCreateStrataArgs(args));
    const root = await mkdtemp(join(tmpdir(), "strata-starter-rendering-"));
    const directory = join(root, "app");
    try {
      generateProject({
        projectName: "render-contract",
        targetDir: directory,
        layers,
        templateRoot: resolveTemplateRoot(),
        overlayRoot: resolveOverlayRoot(),
        // Exercise the existing workspace output mode so unrelated release bumps
        // do not rewrite these byte baselines. Published dependencies have their
        // own compiler, package and installed-runtime acceptance gates.
        workspaceDependencies: true,
      });
      const register = await readFile(join(directory, "src/models/register.ts"), "utf8");
      expect(register).toContain("export const repositoryDefinitions = Object.freeze([");
      expect(register).toContain("export const modelDefinitions = Object.freeze([");
      expect(register).not.toContain("registerModelClass");
      const composition = await readFile(join(directory, "src/bootstrap/createApp.ts"), "utf8");
      expect(composition).toContain("repositories: repositoryDefinitions");
      expect(composition).toContain("models: modelDefinitions");
      const actual: Record<string, unknown> = {};
      async function visit(path: string): Promise<void> {
        for (const item of await readdir(path, { withFileTypes: true })) {
          const full = join(path, item.name);
          if (item.isDirectory()) await visit(full);
          else {
            const relative = full.slice(directory.length + 1);
            actual[relative] = createHash("sha256")
              .update(await readFile(full))
              .digest("hex");
          }
        }
      }
      await visit(directory);
      expect(actual).toEqual(expected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("canonical starter inventory retains the eight existing profiles", () => {
  expect(baselines).toHaveLength(8);
  expect(baselines.map(({ name, args }) => ({ name, args }))).toEqual(
    historical.map(({ name, args }) => ({ name, args })),
  );
});
