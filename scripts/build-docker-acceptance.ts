import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../packages/strata-starter/src/generate.ts";
import { exampleAppLayers } from "../packages/strata-starter/src/presets.ts";

// Build input for the framework's acceptance image, never a deployable product demo.
const app = resolve(process.argv[2] ?? "/opt/strata-acceptance");
const packs = `${app}-packages`;
await mkdir(packs, { recursive: true });
generateProject({
  projectName: "docker-acceptance",
  targetDir: app,
  layers: exampleAppLayers("hiroapp"),
  templateRoot: resolveTemplateRoot(),
  overlayRoot: resolveOverlayRoot(),
});
const manifestPath = join(app, "package.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
for (const part of ["core", "bootstrap", "cli"]) {
  const pack = Bun.spawnSync(
    ["bun", "pm", "pack", "--quiet", "--ignore-scripts", "--destination", packs],
    {
      cwd: join(import.meta.dir, `../packages/strata-${part}`),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30000,
    },
  );
  if (pack.exitCode !== 0)
    throw new Error(`Candidate ${part} pack failed: ${new TextDecoder().decode(pack.stderr)}`);
  const filename = new TextDecoder().decode(pack.stdout).trim().split("\n").at(-1);
  if (!filename) throw new Error(`Missing ${part} tarball`);
  manifest.dependencies[`@getstrata/${part}`] = `file:${resolve(packs, filename)}`;
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
const install = Bun.spawnSync(["bun", "install", "--production", "--ignore-scripts"], {
  cwd: app,
  stdout: "inherit",
  stderr: "inherit",
  timeout: 60000,
});
if (install.exitCode !== 0) throw new Error("Candidate app install failed");
