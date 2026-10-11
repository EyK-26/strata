import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { EtaViewEngine, ViewRenderer } from "@getstrata/core/view";

let directory: string;
let renderer: ViewRenderer;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "strata-htmx-"));
  await mkdir(join(directory, "layouts"));
  await writeFile(join(directory, "page.eta"), "<section><%= it.title %></section>");
  await writeFile(join(directory, "fragment.eta"), "<article><%= it.title %></article>");
  await writeFile(
    join(directory, "layouts/app.eta"),
    "<!doctype html><html><body><%~ it.body %></body></html>",
  );
  await writeFile(join(directory, "layouts/admin.eta"), "<main><%~ it.body %></main>");
  renderer = new ViewRenderer(new EtaViewEngine(directory));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("actual HTTP page/fragment variants vary on every selecting header", async () => {
  const server = createWebServer({
    port: 0,
    routes: {
      "/page": (request: Request) =>
        renderer.renderHtmx(
          "page",
          { title: "<unsafe>" },
          {
            request,
            fragment: "fragment",
            headers: { Vary: "Accept-Encoding", "Cache-Control": "private, no-store" },
          },
        ),
    },
  });
  try {
    for (const hx of [false, true])
      for (const boost of [false, true])
        for (const history of [false, true]) {
          const response = await fetch(`http://localhost:${server.port}/page`, {
            headers: {
              "HX-Request": String(hx),
              "HX-Boosted": String(boost),
              "HX-History-Restore-Request": String(history),
            },
          });
          expect(response.status).toBe(200);
          expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
          expect(response.headers.get("Cache-Control")).toBe("private, no-store");
          expect(response.headers.get("Vary")).toBe(
            "Accept-Encoding, HX-Request, HX-Boosted, HX-History-Restore-Request",
          );
          expect(await response.text()).toBe(
            hx && !boost && !history
              ? "<article>&lt;unsafe&gt;</article>"
              : "<!doctype html><html><body><section>&lt;unsafe&gt;</section></body></html>",
          );
        }
  } finally {
    server.stop(true);
  }
});

test("opt-in rendering accepts request context and explicit request takes precedence", async () => {
  const hx = new Request("http://test/page", { headers: { "HX-Request": "true" } });
  await runWithRequestMeta({ ipAddress: null, userAgent: null, request: hx }, async () => {
    // With no fragment name, only the page template's layout is omitted.
    const fragment = await renderer.renderHtmx("page", { title: "Bare" });
    expect(await fragment.text()).toBe("<section>Bare</section>");
    expect(fragment.headers.get("Vary")).toBe("HX-Request, HX-Boosted, HX-History-Restore-Request");
    const full = await renderer.renderHtmx(
      "page",
      { title: "Full" },
      { request: new Request("http://test/page"), layout: "layouts/admin" },
    );
    expect(await full.text()).toBe("<main><section>Full</section></main>");
    // Ordinary rendering never implicitly selects an HTMX representation.
    const ordinary = await renderer.render("page", { title: "Ordinary" });
    expect(await ordinary.text()).toContain("<!doctype html>");
    expect(ordinary.headers.get("Vary")).toBeNull();
  });
  await expect(renderer.renderHtmx("page")).rejects.toThrow("requires a request");
});

test("Vary merges case-insensitively without mutating caller headers or weakening wildcard", async () => {
  const request = new Request("http://test/page", { headers: { "HX-Request": "true" } });
  const headers = new Headers({
    Vary: "Accept, hx-request, HX-Request, , HX-Boosted",
    "X-Page": "test",
    "Set-Cookie": "test=value; HttpOnly",
  });
  const response = await renderer.renderHtmx(
    "page",
    { title: "Invalid" },
    { request, headers, status: 422, statusText: "Invalid", layout: "layouts/admin" },
  );
  expect(response.status).toBe(422);
  expect(response.statusText).toBe("Invalid");
  expect(response.headers.get("X-Page")).toBe("test");
  expect(response.headers.get("Set-Cookie")).toBe("test=value; HttpOnly");
  expect(response.headers.get("Vary")).toBe(
    "Accept, HX-Request, HX-Boosted, HX-History-Restore-Request",
  );
  expect(headers.get("Vary")).toBe("Accept, hx-request, HX-Request, , HX-Boosted");
  expect(await response.text()).toBe("<section>Invalid</section>");
  const wildcard = await renderer.renderHtmx(
    "page",
    { title: "Wildcard" },
    { request, headers: { Vary: "Accept, *" } },
  );
  expect(wildcard.headers.get("Vary")).toBe("Accept, *");
});

test("false/missing HX headers produce pages and selected template failures propagate", async () => {
  const cases: Record<string, string>[] = [
    {},
    { "HX-Request": "TRUE" },
    { "HX-Boosted": "true" },
    { "HX-History-Restore-Request": "true" },
  ];
  for (const headers of cases) {
    expect(
      await (
        await renderer.renderHtmx(
          "page",
          { title: "Page" },
          { request: new Request("http://test/page", { headers }) },
        )
      ).text(),
    ).toContain("<!doctype html>");
  }
  const request = new Request("http://test/page", { headers: { "HX-Request": "true" } });
  await expect(renderer.renderHtmx("page", {}, { request, fragment: "missing" })).rejects.toThrow();
  await expect(
    renderer.renderHtmx("missing", {}, { request: new Request("http://test/page") }),
  ).rejects.toThrow();
});
