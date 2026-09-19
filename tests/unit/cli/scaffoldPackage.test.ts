import { describe, expect, test } from "bun:test";
import { scaffoldCommands } from "../../../packages/strata-cli/src/scaffold/index.ts";

describe("@getstrata/cli/scaffold", () => {
  test("exports make and queue maintenance command loaders", () => {
    expect(typeof scaffoldCommands["make:module"]).toBe("function");
    expect(typeof scaffoldCommands["make:job"]).toBe("function");
    expect(typeof scaffoldCommands["queue:failed"]).toBe("function");
    expect(scaffoldCommands["queue:work"]).toBeUndefined();
  });
});
