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
      const agents = await readFile(join(directory, "AGENTS.md"), "utf8");
      const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      expect(agents).toContain("# Building render-contract");
      expect(agents).toContain(
        `frontend=${layers.frontend}; database=${layers.database}; auth=${layers.auth};`,
      );
      expect(agents).toContain("src/models/register.ts");
      expect(agents).toContain("transaction.model(Product)");
      expect(agents).not.toContain("validate:host");
      expect(agents).not.toContain("src/core/");
      expect(agents).not.toContain("STRATA_SCHEMA");
      for (const [, command] of agents.matchAll(/^bun run ([\w:]+)$/gm)) {
        expect(manifest.scripts[command as string]).toBeString();
      }
      expect(agents.includes("bun run frontend:build")).toBe(
        ["spa-react", "hybrid"].includes(layers.frontend),
      );
      expect(agents.includes("PostgreSQL RLS is selected")).toBe(layers.tenancy === "rls");
      expect(agents.includes("Column tenancy is selected")).toBe(layers.tenancy === "column");
      expect(agents.includes("Development header auth is selected")).toBe(
        layers.auth === "headers",
      );
      expect(agents.includes("Redis queued work needs")).toBe(layers.queue === "redis");
      expect(await readFile(join(directory, "README.md"), "utf8")).toContain(
        "[AGENTS.md](AGENTS.md)",
      );
      const register = await readFile(join(directory, "src/models/register.ts"), "utf8");
      expect(register).not.toContain("repositoryDefinitions");
      expect(register).toContain("export const modelDefinitions = Object.freeze([");
      expect(register).not.toContain("registerModelClass");
      const composition = await readFile(join(directory, "src/bootstrap/createApp.ts"), "utf8");
      expect(composition).not.toContain("repositories: repositoryDefinitions");
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
