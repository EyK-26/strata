/**
 * Hybrid SPA smoke. Builds frontend/dist for a generated app and fetches /app.
 * HiroApp stays server-htmx. This script is not that app.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../packages/strata-starter/src/parseArgs.ts";

const repoRoot = join(import.meta.dir, "..");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "strata-spa-smoke-"));
  try {
    const flags = parseCreateStrataArgs([
      "spa-smoke",
      "--frontend=hybrid",
      "--database=sqlite",
      "--auth=headers",
      "--yes",
    ]);
    const app = join(root, "spa-smoke");
    generateProject({
      projectName: "spa-smoke",
      targetDir: app,
      layers: layersFromFlags(flags),
      templateRoot: resolveTemplateRoot(),
      overlayRoot: resolveOverlayRoot(),
    });

    const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    pkg.dependencies["@getstrata/core"] = `file:${join(repoRoot, "packages/strata-core")}`;
    pkg.dependencies["@getstrata/bootstrap"] =
      `file:${join(repoRoot, "packages/strata-bootstrap")}`;
    pkg.dependencies["@getstrata/cli"] = `file:${join(repoRoot, "packages/strata-cli")}`;
    await writeFile(join(app, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

    const install = Bun.spawnSync({
      cmd: ["bun", "install"],
      cwd: app,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (install.exitCode !== 0) {
      throw new Error(`bun install failed in generated app:\n${install.stderr.toString()}`);
    }

    const frontendInstall = Bun.spawnSync({
      cmd: ["bun", "run", "frontend:install"],
      cwd: app,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (frontendInstall.exitCode !== 0) {
      throw new Error(`frontend:install failed:\n${frontendInstall.stderr.toString()}`);
    }

    const frontendBuild = Bun.spawnSync({
      cmd: ["bun", "run", "frontend:build"],
      cwd: app,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (frontendBuild.exitCode !== 0) {
      throw new Error(
        `frontend:build failed:\n${frontendBuild.stdout.toString()}\n${frontendBuild.stderr.toString()}`,
      );
    }

    await mkdir(join(app, "storage"), { recursive: true });
    process.env.DATABASE_URL = `sqlite:${join(app, "storage/app.sqlite")}`;
    process.env.APP_ENV = "local";
    process.env.FRONTEND_MODE = "hybrid";
    process.env.SPA_PREFIX = "/app";
    process.env.AUTH_DEV_HEADERS = "true";
    process.env.TENANCY_DRIVER = "none";
    process.env.MAIL_DRIVER = "log";
    process.env.CACHE_DRIVER = "array";
    process.env.QUEUE_DRIVER = "sync";

    const { bootstrapApp, createAppServer } = await import(
      `${join(app, "src/bootstrap/createApp.ts")}`
    );
    const { closeDatabase } = await import(`${join(app, "src/bootstrap/database.ts")}`);
    const { routes } = await bootstrapApp();
    const server = createAppServer(routes, 0);
    const origin = `http://127.0.0.1:${server.port}`;

    try {
      const spa = await fetch(`${origin}/app`);
      const html = await spa.text();
      assert(spa.status === 200, `GET /app status ${spa.status}: ${html.slice(0, 180)}`);
      assert(
        !html.includes("SPA build not found"),
        "GET /app still reports a missing frontend build",
      );
      assert(html.includes('id="root"'), "GET /app did not serve the SPA document");
    } finally {
      server.stop();
      await closeDatabase();
    }

    console.log("Hybrid SPA smoke passed (frontend:build then GET /app).");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
