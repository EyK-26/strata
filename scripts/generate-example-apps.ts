#!/usr/bin/env bun
/**
 * Regenerate the three in-repo example apps from create-strata layer maps.
 * `apps/hiroapp` is CI dogfood for internal end-to-end testing. The siblings
 * are layer maps, not CI dogfood.
 * Usage: bun scripts/generate-example-apps.ts
 */

import { join } from "node:path";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../packages/strata-starter/src/generate.ts";
import { EXAMPLE_APPS, exampleAppLayers } from "../packages/strata-starter/src/presets.ts";
import { EXAMPLE_APP_IDS } from "../packages/strata-starter/src/types.ts";

const repoRoot = join(import.meta.dir, "..");
const appDirs: string[] = [];

for (const id of EXAMPLE_APP_IDS) {
  const layers = exampleAppLayers(id);
  const targetDir = join(repoRoot, "apps", id);
  generateProject({
    projectName: id,
    targetDir,
    layers,
    templateRoot: resolveTemplateRoot(),
    overlayRoot: resolveOverlayRoot(),
    force: true,
    workspaceDependencies: true,
    inRepoExample: true,
    dogfood: id === "hiroapp",
  });
  appDirs.push(targetDir);
  console.log(`Wrote apps/${id} (${layers.frontend}, ${layers.database}, ${layers.auth})`);
}

const biome = Bun.spawnSync({
  cmd: ["bun", "x", "@biomejs/biome", "check", "--write", ...appDirs],
  cwd: repoRoot,
  stdout: "inherit",
  stderr: "inherit",
});
if (biome.exitCode !== 0) {
  throw new Error("biome check --write failed on generated example apps");
}

console.log(`Generated ${Object.keys(EXAMPLE_APPS).length} example apps.`);
