import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAppCommands, resolveApp } from "../../../packages/strata-cli/src/resolveApp.ts";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs.ts";
import { repoRoot } from "./helpers";

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

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "strata-generated-cli-"));
  tempDirectories.push(directory);
  return directory;
}

function generateApp(parent: string, name: string): string {
  const flags = parseCreateStrataArgs([name, "--yes"]);
  const projectName = flags.projectName ?? name;
  const targetDir = join(parent, projectName);
  generateProject({
    projectName,
    targetDir,
    layers: layersFromFlags(flags),
    templateRoot: resolveTemplateRoot(),
    overlayRoot: resolveOverlayRoot(),
  });
  return targetDir;
}

async function installGeneratedAppWithWorkspacePackages(app: string): Promise<void> {
  const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  pkg.dependencies["@getstrata/core"] = `file:${join(repoRoot, "packages/strata-core")}`;
  pkg.dependencies["@getstrata/bootstrap"] = `file:${join(repoRoot, "packages/strata-bootstrap")}`;
  pkg.dependencies["@getstrata/cli"] = `file:${join(repoRoot, "packages/strata-cli")}`;
  await writeFile(join(app, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

  const install = Bun.spawnSync({
    cmd: ["bun", "install"],
    cwd: app,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (install.exitCode !== 0) {
    throw new Error(
      `bun install failed in generated app:\n${install.stderr.toString()}\n${install.stdout.toString()}`,
    );
  }
}

describe("generated app CLI register", () => {
  test("loadAppCommands exposes scaffold and app queue:work", async () => {
    const root = await tempDir();
    const app = generateApp(root, "cli-register");
    await installGeneratedAppWithWorkspacePackages(app);

    const config = await resolveApp(app);
    const commands = await loadAppCommands(config);

    expect(typeof commands["make:job"]).toBe("function");
    expect(typeof commands["queue:work"]).toBe("function");
  });

  test("make:job from generated register writes src/jobs under the app cwd", async () => {
    const root = await tempDir();
    const app = generateApp(root, "cli-make-job");
    await installGeneratedAppWithWorkspacePackages(app);
    const previousCwd = process.cwd();

    try {
      process.chdir(app);
      const config = await resolveApp(app);
      const commands = await loadAppCommands(config);
      const loadMakeJob = commands["make:job"];
      if (!loadMakeJob) {
        throw new Error("expected make:job in generated register");
      }
      const makeJob = await loadMakeJob();
      await makeJob("send invoice");

      const jobPath = join(app, "src/jobs/send-invoiceJob.ts");
      expect(existsSync(jobPath)).toBe(true);
      const source = await readFile(jobPath, "utf8");
      expect(source).toContain('from "@getstrata/core/queue"');
    } finally {
      process.chdir(previousCwd);
    }
  });
});
