import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAppCommands, resolveApp, runCli } from "@getstrata/cli";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs.ts";
import {
  renderCliQueueWorkTs,
  renderCliRegisterTs,
} from "../../../packages/strata-starter/src/renderRuntime.ts";
import { captureConsole, repoRoot } from "./helpers";

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
  const directory = await mkdtemp(join(tmpdir(), "strata-cli-register-"));
  tempDirectories.push(directory);
  return directory;
}

function generateFromArgs(directory: string, argv: string[]): string {
  const flags = parseCreateStrataArgs(argv);
  const name = flags.projectName ?? "app";
  generateProject({
    projectName: name,
    targetDir: join(directory, name),
    layers: layersFromFlags(flags),
    templateRoot: resolveTemplateRoot(),
    overlayRoot: resolveOverlayRoot(),
  });
  return join(directory, name);
}

const PRODUCT_COMMANDS = [
  "make:module",
  "make:policy",
  "make:job",
  "make:listener",
  "make:request",
  "make:factory",
  "make:migration",
  "queue:work",
  "queue:failed",
  "queue:retry",
  "queue:flush-failed",
  "openapi:generate",
  "openapi:validate",
  "openapi:check",
  "schedule:run",
] as const;

describe("generated src/cli/register.ts", () => {
  test("queue:work boots the app, not coreProviders", () => {
    const register = renderCliRegisterTs();
    const queueWork = renderCliQueueWorkTs();
    expect(queueWork).toContain("bootstrapApp({ migrate: false })");
    expect(queueWork).toContain('await import("../bootstrap/createApp.ts")');
    expect(queueWork).toContain("runQueueWorkerCommand");
    expect(queueWork).toContain("@getstrata/cli/queueWorker");
    expect(queueWork).toContain("closeDatabase");
    expect(register).toContain('"queue:work"');
    expect(register).toContain("make:module");
    expect(register).toContain("make:job");
    expect(register).toContain("make:migration");
    expect(register).toContain("openapi:generate");
    expect(register).toContain("schedule:run");
    expect(register).not.toContain("coreProviders");
    expect(register).not.toContain("collectProviders");
    expect(register).not.toContain("@getstrata/bootstrap/context");
    expect(register).not.toContain("createAppContext");
    expect(queueWork).not.toContain("assertProductionSecrets");
    expect(queueWork).not.toContain("coreProviders");
    expect(queueWork).not.toContain("collectProviders");
    expect(queueWork).not.toContain("@getstrata/bootstrap/context");
    expect(queueWork).not.toContain("createAppContext");
  });

  test("generate writes register.ts and strata.config points at it", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["cli-register", "--yes"]);
    const register = await readFile(join(app, "src/cli/register.ts"), "utf8");
    const queueWork = await readFile(join(app, "src/cli/queueWork.ts"), "utf8");
    const config = await readFile(join(app, "strata.config.ts"), "utf8");
    const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(queueWork).toContain("bootstrapApp({ migrate: false })");
    expect(register).not.toContain("coreProviders");
    expect(register).not.toContain("collectProviders");
    expect(register).not.toContain("@getstrata/bootstrap/context");
    expect(register).not.toContain("createAppContext");
    expect(config).toContain('commands: "./src/cli/register.ts"');
    expect(pkg.scripts["queue:work"]).toBe("strata queue:work");
  });

  test("loadAppCommands sees product CLI commands and help lists them", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["cli-register-help", "--yes"]);
    const resolved = await resolveApp(app);
    const commands = await loadAppCommands(resolved);

    expect(resolved.commandsModule).toBe(join(app, "src/cli/register.ts"));
    expect(Object.keys(commands).sort()).toEqual([...PRODUCT_COMMANDS].sort());

    const output = captureConsole();
    try {
      const code = await runCli({
        cwd: app,
        argv: ["help"],
        skipBoot: true,
        exitProcess: false,
      });
      expect(code).toBe(0);
    } finally {
      output.restore();
    }

    const help = output.logs.join("\n");
    expect(help).toContain("queue:work");
    expect(help).toContain("make:module");
    expect(help).toContain("schedule:run");
    expect(help).not.toContain("coreProviders");
  });

  test("queue:work fails closed without REDIS_URL before booting", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["cli-register-redis", "--yes"]);
    const previousRedisUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;

    const output = captureConsole();
    try {
      const code = await runCli({
        cwd: app,
        argv: ["queue:work"],
        skipBoot: true,
        exitProcess: false,
      });
      expect(code).toBe(1);
    } finally {
      output.restore();
      if (previousRedisUrl === undefined) {
        delete process.env.REDIS_URL;
      } else {
        process.env.REDIS_URL = previousRedisUrl;
      }
    }

    expect(output.errors.join("\n")).toContain("queue:work requires REDIS_URL to be set.");
  });

  test("in-repo example apps ship the same CLI registrar as the renderer", async () => {
    const expectedRegister = renderCliRegisterTs();
    const expectedQueueWork = renderCliQueueWorkTs();
    for (const id of ["hiroapp", "hiroapp-hobby", "hiroapp-team"] as const) {
      const actualRegister = await readFile(
        join(repoRoot, `apps/${id}/src/cli/register.ts`),
        "utf8",
      );
      const actualQueueWork = await readFile(
        join(repoRoot, `apps/${id}/src/cli/queueWork.ts`),
        "utf8",
      );
      expect(actualRegister).toBe(expectedRegister);
      expect(actualQueueWork).toBe(expectedQueueWork);
    }
  });
});
