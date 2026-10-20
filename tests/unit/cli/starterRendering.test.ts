import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as databaseDefaults from "../../../packages/strata-starter/src/databaseDefaults.ts";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs.ts";
import * as docker from "../../../packages/strata-starter/src/renderDocker.ts";
import * as legacy from "../../../packages/strata-starter/src/renderEnv.ts";
import baselines from "../../fixtures/scaffolds/starter-rendering.sha256.json";

for (const { name, args, files: expected } of baselines) {
  test(`starter rendering preserves every pre-extraction file and byte: ${name}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "strata-starter-rendering-"));
    const directory = join(root, "app");
    try {
      generateProject({
        projectName: "render-contract",
        targetDir: directory,
        layers: layersFromFlags(parseCreateStrataArgs(args)),
        templateRoot: resolveTemplateRoot(),
        overlayRoot: resolveOverlayRoot(),
        // Exercise the existing workspace output mode so unrelated release bumps
        // do not rewrite these byte baselines. Published dependencies have their
        // own compiler, package and installed-runtime acceptance gates.
        workspaceDependencies: true,
      });
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
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("legacy rendering exports retain the extracted functions and constants", () => {
  expect(legacy.defaultDatabaseUrl).toBe(databaseDefaults.defaultDatabaseUrl);
  expect(legacy.defaultMigrationDatabaseUrl).toBe(databaseDefaults.defaultMigrationDatabaseUrl);
  expect(legacy.appDatabaseName).toBe(databaseDefaults.appDatabaseName);
  expect(legacy.usesComposePostgres).toBe(databaseDefaults.usesComposePostgres);
  expect(legacy.GENERATED_POSTGRES_APP_ROLE).toBe(databaseDefaults.GENERATED_POSTGRES_APP_ROLE);
  expect(legacy.GENERATED_POSTGRES_APP_PASSWORD).toBe(
    databaseDefaults.GENERATED_POSTGRES_APP_PASSWORD,
  );
  expect(legacy.renderDockerCompose).toBe(docker.renderDockerCompose);
  expect(legacy.renderDockerfile).toBe(docker.renderDockerfile);
  expect(legacy.renderDockerignore).toBe(docker.renderDockerignore);
});
