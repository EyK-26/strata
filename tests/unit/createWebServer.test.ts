import { afterEach, describe, expect, test } from "bun:test";
import { createWebServer } from "@getstrata/bootstrap/web/server";
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
});
