import { describe, expect, test } from "bun:test";
import { routeListCommand } from "../../../src/cli/commands/routeList";
import { captureConsole } from "./helpers";

describe("routeListCommand", () => {
  test("lists registered application routes", async () => {
    const output = captureConsole();

    try {
      await routeListCommand();
    } finally {
      output.restore();
    }

    expect(output.logs.length).toBeGreaterThan(0);
    expect(output.logs.some((line) => line.includes("GET") && line.includes("/health"))).toBe(true);
    expect(output.logs.some((line) => line.includes("/api/") || line.includes("/api/v1"))).toBe(
      true,
    );
  });
});
