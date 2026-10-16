import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../packages/strata-starter/src/generate.ts";
import { exampleAppLayers } from "../../packages/strata-starter/src/presets.ts";
import requiredFiles from "../fixtures/generated-source-files.json";

/** Source inspection only; packed-package execution is covered by generated-app E2E. */
export function createGeneratedSourceApps() {
  const parent = join(import.meta.dir, "../../node_modules/.cache");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "strata-source-"));
  const rls = join(root, "rls");
  const team = join(root, "team");
  const hobby = join(root, "hobby");
  const close = () => rmSync(root, { recursive: true, force: true });
  try {
    for (const [targetDir, preset] of [
      [rls, "hiroapp"],
      [team, "hiroapp-team"],
      [hobby, "hiroapp-hobby"],
    ] as const) {
      generateProject({
        projectName: `source-${preset}`,
        targetDir,
        layers: exampleAppLayers(preset),
        templateRoot: resolveTemplateRoot(),
        overlayRoot: resolveOverlayRoot(),
      });
    }
    // Frozen before retiring the checked-in apps: missing generated source must fail setup.
    for (const [profile, directory] of [
      ["rls", rls],
      ["team", team],
    ] as const) {
      for (const file of requiredFiles[profile]) {
        if (!existsSync(join(directory, file))) {
          throw new Error(`Generated ${profile} acceptance fixture is missing ${file}`);
        }
      }
    }
    return { rls, team, hobby, close };
  } catch (error) {
    close();
    throw error;
  }
}
