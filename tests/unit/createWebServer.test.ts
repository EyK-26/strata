import { afterEach, describe, expect, test } from "bun:test";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { resetWebErrorViewForTests } from "@getstrata/core/view/webErrorView";

describe("createWebServer", () => {
  afterEach(() => {
    resetWebErrorViewForTests();
  });

  test("unknown routes return styled HTML 404", async () => {
    const server = createWebServer({ port: 0 });
    const response = await fetch(`http://localhost:${server.port}/forum/nope/nope`);
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('href="/assets/app.css"');
    expect(html).toContain("Not Found");

    server.stop(true);
  });

  test("null handlers return styled HTML 404", async () => {
    const server = createWebServer({
      port: 0,
      routes: {
        "/gone": async () => null,
      },
    });
    const response = await fetch(`http://localhost:${server.port}/gone`);
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Not Found");

    server.stop(true);
  });

  test("records the socket address so throttles key on the real client", async () => {
    const server = createWebServer({
      port: 0,
      routes: {
        "/whoami": async () => new Response(currentRequestMeta().ipAddress ?? "none"),
      },
      handle: async () => new Response(currentRequestMeta().ipAddress ?? "none"),
    });

    const viaRoute = await fetch(`http://127.0.0.1:${server.port}/whoami`);
    expect(await viaRoute.text()).toBe("127.0.0.1");

    const viaFetch = await fetch(`http://127.0.0.1:${server.port}/anything-else`);
    expect(await viaFetch.text()).toBe("127.0.0.1");

    server.stop(true);
  });
});
