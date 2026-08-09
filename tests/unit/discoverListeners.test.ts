import { describe, expect, test } from "bun:test";
import { discoverListeners } from "../../src/bootstrap/discoverListeners";

describe("discoverListeners", () => {
  test("returns no registrars when src/listeners is absent", () => {
    const listeners = discoverListeners();

    expect(listeners).toEqual([]);
  });
});
