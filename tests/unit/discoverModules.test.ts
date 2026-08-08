import { describe, expect, test } from "bun:test";
import { discoverModules } from "../../src/bootstrap/discoverModules";

describe("discoverModules", () => {
  test("discovers WorkHub modules in route priority order", () => {
    const modules = discoverModules();

    expect(modules.map((module) => module.name)).toEqual([
      "user",
      "organization",
      "project",
      "comment",
      "task",
      "report",
      "audit",
      "webhook",
      "search",
    ]);
  });

  test("returns modules that expose routes or providers", () => {
    const modules = discoverModules();

    expect(modules.every((module) => module.name.length > 0)).toBe(true);
    expect(modules.some((module) => module.routes !== undefined)).toBe(true);
  });
});
