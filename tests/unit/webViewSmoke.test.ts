import { describe, expect, test } from "bun:test";
import { fetchPageText, resolveWebViewBackend } from "../../src/testing/webViewSmoke.ts";

describe("webViewSmoke", () => {
  test("resolveWebViewBackend prefers chrome off macOS", () => {
    expect(resolveWebViewBackend("chrome")).toBe("chrome");
    expect(resolveWebViewBackend()).toBe(process.platform === "darwin" ? "webkit" : "chrome");
  });

  test("fetchPageText reads rendered HTML", async () => {
    if (process.env.CI === "true") {
      return;
    }

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response("<html><body><h1>Strata smoke</h1></body></html>", {
          headers: { "content-type": "text/html" },
        }),
    });
    try {
      const text = await fetchPageText({ url: new URL("/", server.url).href, backend: "chrome" });
      expect(text).toContain("Strata smoke");
    } finally {
      await server.stop(true);
    }
  }, 30_000);
});
