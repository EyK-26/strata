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
import { renderCliRegisterTs } from "../../../packages/strata-starter/src/renderRuntime.ts";
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

describe("generated src/cli/register.ts", () => {
  test("queue:work boots the app, not coreProviders", () => {
    const source = renderCliRegisterTs();
    expect(source).toContain("bootstrapApp({ migrate: false })");
    expect(source).toContain('await import("../bootstrap/createApp.ts")');
    expect(source).toContain("createQueueWorker");
    expect(source).toContain("closeDatabase");
    expect(source).toContain('"queue:work"');
    expect(source).not.toContain("coreProviders");
    expect(source).not.toContain("collectProviders");
    expect(source).not.toContain("@getstrata/bootstrap/context");
    expect(source).not.toContain("createAppContext");
    expect(source).not.toContain("make:module");
    expect(source).not.toContain("make:job");
  });

  test("generate writes register.ts and strata.config points at it", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["cli-register", "--yes"]);
    const register = await readFile(join(app, "src/cli/register.ts"), "utf8");
    const config = await readFile(join(app, "strata.config.ts"), "utf8");
    const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(register).toContain("bootstrapApp({ migrate: false })");
    expect(register).not.toContain("coreProviders");
    expect(register).not.toContain("collectProviders");
    expect(register).not.toContain("@getstrata/bootstrap/context");
    expect(register).not.toContain("createAppContext");
    expect(config).toContain('commands: "./src/cli/register.ts"');
    expect(pkg.scripts["queue:work"]).toBe("strata queue:work");
  });

  test("loadAppCommands sees queue:work and help lists it", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["cli-register-help", "--yes"]);
    const resolved = await resolveApp(app);
    const commands = await loadAppCommands(resolved);

    expect(resolved.commandsModule).toBe(join(app, "src/cli/register.ts"));
    expect(Object.keys(commands)).toEqual(["queue:work"]);

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

    expect(output.logs.join("\n")).toContain("queue:work");
    expect(output.logs.join("\n")).not.toContain("make:module");
    expect(output.logs.join("\n")).not.toContain("coreProviders");
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

  test("in-repo example apps ship the same register.ts as the renderer", async () => {
    const expected = renderCliRegisterTs();
    for (const id of ["hiroapp", "hiroapp-hobby", "hiroapp-team"] as const) {
      const actual = await readFile(join(repoRoot, `apps/${id}/src/cli/register.ts`), "utf8");
      expect(actual).toBe(expected);
    }
  });
});
