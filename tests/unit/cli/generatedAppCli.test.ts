import { afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDiscoverModulesForTests } from "@getstrata/bootstrap/discoverModules";
import * as createAppQueueModule from "@getstrata/core/queue/createAppQueue";
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
import { resetDiscoverModulesForUnitTests } from "../../helpers/discoverModulesTest.ts";
import { ensureWorkspacePackagesBuilt } from "../../helpers/generatedAppHarness.ts";
import { captureConsole, mockProcessExit, repoRoot } from "./helpers";

const tempDirectories: string[] = [];

const ENV_KEYS = [
  "DATABASE_URL",
  "APP_ENV",
  "FRONTEND_MODE",
  "AUTH_DEV_HEADERS",
  "TENANCY_DRIVER",
  "REDIS_URL",
] as const;

afterEach(async () => {
  mock.restore();
  resetDiscoverModulesForUnitTests();
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
  await ensureWorkspacePackagesBuilt();

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
    expect(typeof commands["openapi:generate"]).toBe("function");
    expect(typeof commands["schedule:run"]).toBe("function");
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

  test("generated queue:work runs bootstrapApp before the redis worker starts", async () => {
    const root = await tempDir();
    const app = generateApp(root, "cli-queue-work");
    await installGeneratedAppWithWorkspacePackages(app);

    const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    const previousCwd = process.cwd();
    let workerCreatedAfterBoot = false;

    mock.module("@getstrata/bootstrap/secretsGuard", () => ({
      assertProductionSecrets: () => undefined,
    }));
    mock.module("@getstrata/core/queue/createAppQueue", () => ({
      ...createAppQueueModule,
      createFailedJobService: () => ({}),
      createQueueWorker: () => {
        workerCreatedAfterBoot = true;
        return {
          run: async () => undefined,
          requestStop: () => undefined,
        };
      },
    }));

    try {
      process.chdir(app);
      process.env.DATABASE_URL = "sqlite:./storage/app.sqlite";
      process.env.APP_ENV = "local";
      process.env.FRONTEND_MODE = "api";
      process.env.AUTH_DEV_HEADERS = "true";
      process.env.TENANCY_DRIVER = "none";
      process.env.REDIS_URL = "redis://127.0.0.1:6379";
      resetDiscoverModulesForTests();

      const { queueWorkCommand } = await import(join(app, "src/cli/commands/queueWork.ts"));
      await queueWorkCommand();

      expect(workerCreatedAfterBoot).toBe(true);

      const { closeDatabase } = await import(join(app, "src/bootstrap/database.ts"));
      await closeDatabase();
    } finally {
      resetDiscoverModulesForTests();
      process.chdir(previousCwd);
      for (const key of ENV_KEYS) {
        const value = previousEnv[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test("openapi:generate writes docs/openapi.json using app createApp routes", async () => {
    const root = await tempDir();
    const app = generateApp(root, "cli-openapi");
    await installGeneratedAppWithWorkspacePackages(app);
    await mkdir(join(app, "docs"), { recursive: true });

    const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    const previousCwd = process.cwd();

    try {
      process.chdir(app);
      process.env.DATABASE_URL = "sqlite:./storage/app.sqlite";
      process.env.APP_ENV = "local";
      process.env.FRONTEND_MODE = "api";
      process.env.AUTH_DEV_HEADERS = "true";
      process.env.TENANCY_DRIVER = "none";
      resetDiscoverModulesForTests();

      const config = await resolveApp(app);
      const commands = await loadAppCommands(config);
      const loadGenerate = commands["openapi:generate"];
      if (!loadGenerate) {
        throw new Error("expected openapi:generate");
      }
      const openapiGenerate = await loadGenerate();
      const output = captureConsole();
      try {
        await openapiGenerate();
      } finally {
        output.restore();
      }

      const specPath = join(app, "docs/openapi.json");
      expect(existsSync(specPath)).toBe(true);
      const spec = await readFile(specPath, "utf8");
      expect(spec).toContain('"openapi"');
      expect(output.logs[0]).toMatch(/^OpenAPI spec written to .*openapi\.json \(\d+ routes\)\.$/);

      const { closeDatabase } = await import(join(app, "src/bootstrap/database.ts"));
      await closeDatabase();
    } finally {
      resetDiscoverModulesForTests();
      process.chdir(previousCwd);
      for (const key of ENV_KEYS) {
        const value = previousEnv[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test("openapi:check passes when docs/openapi.json matches generated output", async () => {
    const root = await tempDir();
    const app = generateApp(root, "cli-openapi-check");
    await installGeneratedAppWithWorkspacePackages(app);
    await mkdir(join(app, "docs"), { recursive: true });

    const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    const previousCwd = process.cwd();

    try {
      process.chdir(app);
      process.env.DATABASE_URL = "sqlite:./storage/app.sqlite";
      process.env.APP_ENV = "local";
      process.env.FRONTEND_MODE = "api";
      process.env.AUTH_DEV_HEADERS = "true";
      process.env.TENANCY_DRIVER = "none";
      resetDiscoverModulesForTests();

      const config = await resolveApp(app);
      const commands = await loadAppCommands(config);
      const loadOpenApiGenerate = commands["openapi:generate"];
      if (!loadOpenApiGenerate) {
        throw new Error("expected openapi:generate");
      }
      const openapiGenerate = await loadOpenApiGenerate();
      await openapiGenerate();

      const loadOpenApiCheck = commands["openapi:check"];
      if (!loadOpenApiCheck) {
        throw new Error("expected openapi:check");
      }
      const openapiCheck = await loadOpenApiCheck();
      const output = captureConsole();
      try {
        await openapiCheck();
      } finally {
        output.restore();
      }

      expect(output.logs[0]).toMatch(/^OpenAPI spec matches committed file \(\d+ routes\)\.$/);

      const { closeDatabase } = await import(join(app, "src/bootstrap/database.ts"));
      await closeDatabase();
    } finally {
      resetDiscoverModulesForTests();
      process.chdir(previousCwd);
      for (const key of ENV_KEYS) {
        const value = previousEnv[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test("openapi:check fails when docs/openapi.json drifts", async () => {
    const root = await tempDir();
    const app = generateApp(root, "cli-openapi-drift");
    await installGeneratedAppWithWorkspacePackages(app);
    await mkdir(join(app, "docs"), { recursive: true });

    const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    const previousCwd = process.cwd();
    const exit = mockProcessExit();

    try {
      process.chdir(app);
      process.env.DATABASE_URL = "sqlite:./storage/app.sqlite";
      process.env.APP_ENV = "local";
      process.env.FRONTEND_MODE = "api";
      process.env.AUTH_DEV_HEADERS = "true";
      process.env.TENANCY_DRIVER = "none";
      resetDiscoverModulesForTests();

      const config = await resolveApp(app);
      const commands = await loadAppCommands(config);
      const loadOpenApiGenerate = commands["openapi:generate"];
      if (!loadOpenApiGenerate) {
        throw new Error("expected openapi:generate");
      }
      const openapiGenerate = await loadOpenApiGenerate();
      await openapiGenerate();

      await writeFile(join(app, "docs/openapi.json"), '{"openapi":"3.1.0"}', "utf8");

      const loadOpenApiCheck = commands["openapi:check"];
      if (!loadOpenApiCheck) {
        throw new Error("expected openapi:check");
      }
      const openapiCheck = await loadOpenApiCheck();
      const output = captureConsole();
      try {
        await expect(openapiCheck()).rejects.toThrow("process.exit");
      } finally {
        output.restore();
      }

      expect(exit.getCode()).toBe(1);
      expect(output.errors.some((line) => line.includes("OpenAPI spec drift detected."))).toBe(
        true,
      );

      const { closeDatabase } = await import(join(app, "src/bootstrap/database.ts"));
      await closeDatabase();
    } finally {
      exit.restore();
      resetDiscoverModulesForTests();
      process.chdir(previousCwd);
      for (const key of ENV_KEYS) {
        const value = previousEnv[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test("schedule:run loads generated schedule and runs the shared scheduler", async () => {
    const root = await tempDir();
    const app = generateApp(root, "cli-schedule");
    await installGeneratedAppWithWorkspacePackages(app);

    const previousCwd = process.cwd();
    try {
      process.chdir(app);
      const config = await resolveApp(app);
      const commands = await loadAppCommands(config);
      const loadSchedule = commands["schedule:run"];
      if (!loadSchedule) {
        throw new Error("expected schedule:run");
      }
      const scheduleRun = await loadSchedule();
      const output = captureConsole();
      try {
        await scheduleRun();
      } finally {
        output.restore();
      }
      expect(output.logs[0]).toMatch(/^(No scheduled tasks due\.|Running scheduled task:)/);
    } finally {
      process.chdir(previousCwd);
    }
  });
});
