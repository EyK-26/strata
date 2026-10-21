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
import * as bootstrap from "../../../packages/strata-starter/src/renderBootstrap.ts";
import * as cli from "../../../packages/strata-starter/src/renderCli.ts";
import * as database from "../../../packages/strata-starter/src/renderDatabase.ts";
import * as docker from "../../../packages/strata-starter/src/renderDocker.ts";
import * as documentation from "../../../packages/strata-starter/src/renderDocumentation.ts";
import * as legacy from "../../../packages/strata-starter/src/renderEnv.ts";
import * as environment from "../../../packages/strata-starter/src/renderEnvironment.ts";
import * as migrations from "../../../packages/strata-starter/src/renderMigrations.ts";
import * as models from "../../../packages/strata-starter/src/renderModels.ts";
import * as metadata from "../../../packages/strata-starter/src/renderProjectMetadata.ts";
import * as runtime from "../../../packages/strata-starter/src/renderRuntime.ts";
import currentAuthModules from "../../fixtures/scaffolds/starter-password-operation-current.sha256.json";
import baselines from "../../fixtures/scaffolds/starter-rendering.sha256.json";
import { passwordLoginArtifactRoundTrip } from "../../helpers/authLoginArtifactDelta.ts";

const currentModuleHashes: Readonly<Record<string, string | null>> = currentAuthModules;

for (const { name, args, files: expected } of baselines) {
  test(`starter rendering preserves every pre-extraction file and byte: ${name}`, async () => {
    const layers = layersFromFlags(parseCreateStrataArgs(args));
    const currentHash = currentModuleHashes[name];
    if (currentHash === undefined) throw new Error(`Missing current project auth hash: ${name}`);
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
      const actual: Record<string, unknown> = {};
      async function visit(path: string): Promise<void> {
        for (const item of await readdir(path, { withFileTypes: true })) {
          const full = join(path, item.name);
          if (item.isDirectory()) await visit(full);
          else {
            const relative = full.slice(directory.length + 1);
            const bytes = await readFile(full);
            if (relative === "src/modules/auth/index.ts") {
              const source = bytes.toString("utf8");
              const { legacy, roundTrip } = passwordLoginArtifactRoundTrip(source, layers);
              expect(roundTrip).toBe(source);
              if (currentHash === null || currentHash === undefined)
                throw new Error(`Unexpected auth artifact for current project profile: ${name}`);
              expect(createHash("sha256").update(bytes).digest("hex")).toBe(currentHash);
              if (legacy === null)
                throw new Error("An existing auth artifact must retain its legacy bytes.");
              actual[relative] = createHash("sha256").update(legacy).digest("hex");
            } else actual[relative] = createHash("sha256").update(bytes).digest("hex");
          }
        }
      }
      await visit(directory);
      expect(Object.hasOwn(actual, "src/modules/auth/index.ts")).toBe(currentHash !== null);
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

test("legacy runtime imports retain every artifact function's identity", () => {
  const artifacts: Record<string, unknown> = {
    ...bootstrap,
    ...cli,
    ...database,
    ...migrations,
    ...models,
  };
  expect(Object.keys(runtime)).toHaveLength(35);
  for (const [name, render] of Object.entries(runtime)) {
    expect(artifacts[name], name).toBe(render);
  }
});

test("legacy environment imports retain all artifact function and constant identities", () => {
  const artifacts: Record<string, unknown> = {
    ...databaseDefaults,
    ...docker,
    ...documentation,
    ...environment,
    ...metadata,
  };
  expect(Object.keys(legacy)).toHaveLength(16);
  for (const [name, artifact] of Object.entries(legacy)) {
    expect(artifacts[name], name).toBe(artifact);
  }
});

test("current project auth hash inventory retains every historical scaffold profile", () => {
  expect(Object.keys(currentAuthModules).sort()).toEqual(baselines.map(({ name }) => name).sort());
});
