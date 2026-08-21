import { describe, expect, test } from "bun:test";
import { fetchPageText, resolveWebViewBackend } from "../../src/testing/webViewSmoke.ts";

describe("webViewSmoke", () => {
  test("resolveWebViewBackend prefers chrome off macOS", () => {
    expect(resolveWebViewBackend("chrome")).toBe("chrome");
    expect(resolveWebViewBackend()).toBe(process.platform === "darwin" ? "webkit" : "chrome");
  });

  test("fetchPageText reads rendered HTML", async () => {
    const text = await fetchPageText({
      url: "data:text/html,<html><body><h1>Strata smoke</h1></body></html>",
      backend: "chrome",
    });

    expect(text).toContain("Strata smoke");
  });
});
