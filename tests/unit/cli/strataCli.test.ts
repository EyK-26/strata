import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveApp, runCli } from "@getstrata/cli";

const tempDirectories: string[] = [];

afterEach(async () => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

async function createTempApp(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "strata-cli-app-"));
  tempDirectories.push(workspace);
  await mkdir(join(workspace, "src/bootstrap"), { recursive: true });
  await mkdir(join(workspace, "src/db"), { recursive: true });
  await mkdir(join(workspace, "src/scripts"), { recursive: true });

  await writeFile(
    join(workspace, "src/bootstrap/preload.ts"),
    `process.env.STRATA_PRELOAD = "1";\n`,
  );
  await writeFile(join(workspace, "src/bootstrap/server.ts"), `console.log("server-ok");\n`);
  await writeFile(
    join(workspace, "src/db/migrate.ts"),
    `export async function migrate() { console.log("migrated"); }
export async function seed() { console.log("seeded"); }
`,
  );
  await writeFile(
    join(workspace, "src/db/fresh.ts"),
    `export async function fresh() { console.log("fresh"); }
`,
  );
  await writeFile(
    join(workspace, "src/scripts/echo.ts"),
    `console.log("preload=" + (process.env.STRATA_PRELOAD ?? "0"));
console.log("script-ok");
`,
  );

  return workspace;
}

describe("published strata CLI", () => {
  test("does not import a product-app src/cli", async () => {
    const source = await readFile(
      join(import.meta.dir, "../../../packages/strata-cli/cli.ts"),
      "utf8",
    );
    expect(source).not.toContain("src/cli/index");
    expect(source).not.toContain("../../src/cli");
  });

  test("resolveApp uses conventions from cwd", async () => {
    const workspace = await createTempApp();
    const app = await resolveApp(workspace);

    expect(app.root).toBe(workspace);
    expect(app.preload).toBe(join(workspace, "src/bootstrap/preload.ts"));
    expect(app.server).toBe(join(workspace, "src/bootstrap/server.ts"));
    expect(app.migrate).toBe(join(workspace, "src/db/migrate.ts"));
    expect(app.fresh).toBe(join(workspace, "src/db/fresh.ts"));
  });

  test("resolveApp honors strata.config.ts", async () => {
    const workspace = await createTempApp();
    await mkdir(join(workspace, "app"), { recursive: true });
    await writeFile(join(workspace, "app/server.ts"), `console.log("custom-server");\n`);
    await writeFile(
      join(workspace, "strata.config.ts"),
      `export default { server: "./app/server.ts" };\n`,
    );

    const app = await resolveApp(workspace);
    expect(app.server).toBe(join(workspace, "app/server.ts"));
  });

  test("help lists framework commands without a product app", async () => {
    const workspace = await createTempApp();
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      const code = await runCli({
        cwd: workspace,
        argv: ["help"],
        skipBoot: true,
        exitProcess: false,
      });
      expect(code).toBe(0);
    } finally {
      console.log = originalLog;
    }

    expect(logs.join("\n")).toContain("dev");
    expect(logs.join("\n")).toContain("migrate");
    expect(logs.join("\n")).not.toContain("secrets:check");
    expect(logs.join("\n")).not.toContain("openapi:validate");
  });

  test("migrate runs the app migrate entry", async () => {
    const workspace = await createTempApp();
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      const code = await runCli({
        cwd: workspace,
        argv: ["migrate"],
        skipBoot: true,
        exitProcess: false,
      });
      expect(code).toBe(0);
    } finally {
      console.log = originalLog;
    }

    expect(logs).toContain("migrated");
    expect(logs).toContain("seeded");
  });

  test("rejects unknown commands", async () => {
    const workspace = await createTempApp();
    const errors: string[] = [];
    const originalError = console.error;
    const originalLog = console.log;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    console.log = () => {};

    try {
      const code = await runCli({
        cwd: workspace,
        argv: ["not-a-real-command"],
        skipBoot: true,
        exitProcess: false,
      });
      expect(code).toBe(1);
    } finally {
      console.error = originalError;
      console.log = originalLog;
    }

    expect(errors.join("\n")).toContain("Unknown command: not-a-real-command");
  });

  test("run executes a file with the app preload", async () => {
    const workspace = await createTempApp();
    const proc = Bun.spawn(
      [
        "bun",
        join(import.meta.dir, "../../../packages/strata-cli/cli.ts"),
        "run",
        "src/scripts/echo.ts",
      ],
      {
        cwd: workspace,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("preload=1");
    expect(stdout).toContain("script-ok");
  });
});
