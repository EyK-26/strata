import { describe, expect, test } from "bun:test";
import { discoverListeners } from "../../src/bootstrap/discoverListeners";

describe("discoverListeners", () => {
  test("loads WorkHub registrars from src/listeners", () => {
    const listeners = discoverListeners();

    expect(listeners.length).toBeGreaterThanOrEqual(3);
    expect(listeners.every((register) => typeof register === "function")).toBe(true);
  });
});
