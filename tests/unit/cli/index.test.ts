import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restoreEnvVar } from "../../helpers/restoreEnv";
import { formatCliResult, repoRoot, runCli } from "./helpers";

describe("cli index", () => {
  afterEach(() => {
    process.chdir(repoRoot);
  });

  test("defaults to help when no command is provided", async () => {
    const result = await runCli([]);

    if (result.exitCode !== 0) {
      throw new Error(`CLI help failed.\n${formatCliResult(result)}`);
    }
    expect(result.stdout).toContain("Available commands:");
    expect(result.stdout).toContain("route:list");
  });

  test("runs help command", async () => {
    const result = await runCli(["help"]);

    if (result.exitCode !== 0) {
      throw new Error(`CLI help failed.\n${formatCliResult(result)}`);
    }
    expect(result.stdout).toContain("Available commands:");
    expect(result.stdout).toContain("openapi:validate");
  });

  test("runs help from a temp cwd", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "strata-cli-cwd-"));

    try {
      process.chdir(workspace);
      const result = await runCli(["help"]);
      if (result.exitCode !== 0) {
        throw new Error(`CLI help failed after chdir.\n${formatCliResult(result)}`);
      }
      expect(result.stdout).toContain("Available commands:");
    } finally {
      process.chdir(repoRoot);
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("runs route:list command", async () => {
    const result = await runCli(["route:list"]);

    if (result.exitCode !== 0) {
      throw new Error(`CLI route:list failed.\n${formatCliResult(result)}`);
    }
    expect(result.stdout).toContain("GET");
    expect(result.stdout).toContain("/health");
  });

  test("runs openapi:validate command", async () => {
    const result = await runCli(["openapi:validate"]);

    if (result.exitCode !== 0) {
      throw new Error(`CLI openapi:validate failed.\n${formatCliResult(result)}`);
    }
    expect(result.stdout).toMatch(/OpenAPI spec valid \(\d+ routes\)\./);
  });

  test("runs migrate:status command", async () => {
    const previousSchema = process.env.STRATA_SCHEMA;
    process.env.STRATA_SCHEMA = "fixture";
    try {
      const result = await runCli(["migrate:status"]);

      if (result.exitCode !== 0) {
        throw new Error(`CLI migrate:status failed.\n${formatCliResult(result)}`);
      }
      expect(result.stdout).toContain("Migration status:");
    } finally {
      restoreEnvVar("STRATA_SCHEMA", previousSchema);
    }
  });

  test("exits with error for unknown commands", async () => {
    const result = await runCli(["not-a-real-command"]);

    if (result.exitCode !== 1) {
      throw new Error(
        `CLI unknown command exit ${result.exitCode}, expected 1.\n${formatCliResult(result)}`,
      );
    }
    expect(result.stderr).toContain("Unknown command: not-a-real-command");
    expect(result.stdout).toContain("Available commands:");
  });
});
