import { describe, expect, test } from "bun:test";
import { runCli } from "./helpers";

describe("cli index", () => {
  test("defaults to help when no command is provided", async () => {
    const result = await runCli([]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Available commands:");
    expect(result.stdout).toContain("route:list");
  });

  test("runs help command", async () => {
    const result = await runCli(["help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Available commands:");
    expect(result.stdout).toContain("openapi:validate");
  });

  test("runs route:list command", async () => {
    const result = await runCli(["route:list"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("GET");
    expect(result.stdout).toContain("/health");
  });

  test("runs openapi:validate command", async () => {
    const result = await runCli(["openapi:validate"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/OpenAPI spec valid \(\d+ routes\)\./);
  });

  test("runs migrate:status command", async () => {
    const result = await runCli(["migrate:status"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Migration status:");
  });

  test("exits with error for unknown commands", async () => {
    const result = await runCli(["not-a-real-command"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command: not-a-real-command");
    expect(result.stdout).toContain("Available commands:");
  });
});
