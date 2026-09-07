import { describe, expect, test } from "bun:test";
import { missingOptionalPeer } from "../../src/core/runtime/optionalPeer.ts";

describe("missingOptionalPeer", () => {
  test("names the package, reason, and install command", () => {
    const cause = new Error("Cannot find package");
    const error = missingOptionalPeer("mysql2", "to open a MySQL connection", cause);
    expect(error.message).toBe("Install mysql2 to open a MySQL connection (`bun add mysql2`).");
    expect(error.cause).toBe(cause);
  });

  test("uses the same shape for eta", () => {
    const error = missingOptionalPeer("eta", "to render HTML views", new Error("missing"));
    expect(error.message).toBe("Install eta to render HTML views (`bun add eta`).");
  });
});
