import { describe, expect, test } from "bun:test";
import { createCsrfProtection } from "../../src/core/http/csrfProtection";

describe("createCsrfProtection", () => {
  test("generates and verifies tokens with Bun.CSRF", () => {
    const csrf = createCsrfProtection("unit-test-secret");

    const token = csrf.generate("guest");
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(10);
    expect(csrf.verify(token)).toBe(true);
    expect(csrf.verify("not-a-token")).toBe(false);
    expect(csrf.verify(undefined)).toBe(false);
  });
});
