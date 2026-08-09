import { afterAll, describe, expect, mock, test } from "bun:test";
import type { Mailer } from "@getstrata/core/mail/mailer";
import type { StorageManager } from "@getstrata/core/storage/storage";
import { restoreEnvVar } from "../../helpers/restoreEnv";
import { cliTestEnv, formatCliResult, repoRoot } from "./helpers";

afterAll(() => {
  mock.restore();
});

describe("createTinkerContext", () => {
  test("exposes container and facades", async () => {
    mock.restore();
    const { createTinkerContext: createContext } = await import("../../../src/cli/commands/tinker");
    const context = createContext();

    expect(context.container).toBeDefined();
    expect(context.dependencies.container).toBe(context.container);
    expect(typeof context.mailer).toBe("function");
    expect(typeof context.storage).toBe("function");
  });

  test("assignTinkerGlobals exposes globals for the REPL preload", async () => {
    mock.restore();
    const { assignTinkerGlobals: assignGlobals, createTinkerContext: createContext } = await import(
      "../../../src/cli/commands/tinker"
    );
    const context = createContext();
    assignGlobals(context);

    expect((globalThis as { container?: unknown }).container).toBe(context.container);
    expect(typeof (globalThis as { mailer?: () => Mailer }).mailer).toBe("function");
    expect(typeof (globalThis as { storage?: () => StorageManager }).storage).toBe("function");
  });
});

describe("tinker preload script", () => {
  test("runs a one-liner against the tinker context", async () => {
    const script = `
      import { createTinkerContext } from "./src/cli/commands/tinker.ts";
      const ctx = createTinkerContext();
      console.log(JSON.stringify({
        hasContainer: Boolean(ctx.container),
        mailerName: ctx.mailer().constructor.name,
      }));
    `;

    const previousMailDriver = process.env.MAIL_DRIVER;
    const previousMailHost = process.env.MAIL_HOST;
    process.env.MAIL_DRIVER = "smtp";
    delete process.env.MAIL_HOST;

    const proc = Bun.spawn(["bun", "-e", script], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: cliTestEnv(),
    });

    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (exitCode !== 0 || stderr !== "") {
        throw new Error(
          `tinker one-liner failed.\n${formatCliResult({ stdout, stderr, exitCode })}`,
        );
      }
      expect(JSON.parse(stdout)).toMatchObject({ hasContainer: true });
    } finally {
      restoreEnvVar("MAIL_DRIVER", previousMailDriver);
      restoreEnvVar("MAIL_HOST", previousMailHost);
    }
  });
});
