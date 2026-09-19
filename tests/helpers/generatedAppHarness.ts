import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../packages/strata-starter/src/parseArgs.ts";

const repoRoot = join(import.meta.dir, "../..");
let workspacePackagesBuilt = false;

async function ensureWorkspacePackagesBuilt(): Promise<void> {
  if (workspacePackagesBuilt) {
    return;
  }
  for (const script of ["build:framework", "build:bootstrap"] as const) {
    const build = Bun.spawnSync({
      cmd: ["bun", "run", script],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (build.exitCode !== 0) {
      throw new Error(`${script} failed:\n${build.stderr.toString()}`);
    }
  }
  workspacePackagesBuilt = true;
}

async function generateAndInstallApp(
  name: string,
): Promise<{ app: string; cleanup: () => Promise<void> }> {
  await ensureWorkspacePackagesBuilt();
  const parent = await mkdtemp(join(tmpdir(), "strata-generated-app-"));
  const flags = parseCreateStrataArgs([name, "--yes"]);
  const projectName = flags.projectName ?? name;
  const app = join(parent, projectName);

  generateProject({
    projectName,
    targetDir: app,
    layers: layersFromFlags(flags),
    templateRoot: resolveTemplateRoot(),
    overlayRoot: resolveOverlayRoot(),
  });

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
    throw new Error(`bun install failed:\n${install.stderr.toString()}`);
  }

  return {
    app,
    cleanup: async () => {
      await rm(parent, { recursive: true, force: true });
    },
  };
}

function applyGeneratedAppSqliteEnv(): void {
  process.env.DATABASE_URL = "sqlite:./storage/app.sqlite";
  process.env.APP_ENV = "local";
  process.env.FRONTEND_MODE = "api";
  process.env.AUTH_DEV_HEADERS = "true";
  process.env.TENANCY_DRIVER = "none";
  process.env.QUEUE_DRIVER = "redis";
}

export { applyGeneratedAppSqliteEnv, generateAndInstallApp, repoRoot };
