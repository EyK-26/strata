import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore, ServiceContainer } from "@getstrata/core/contracts/container";
import { runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { CORE_VIEW_RENDERER_TOKEN, EtaViewEngine, ViewRenderer } from "@getstrata/core/view";
import {
  configureWebLayoutData,
  resetWebLayoutDataConfigForTests,
} from "@getstrata/core/view/webLayoutData";
import { CORE_VIEW_TOKEN, createViewProvider } from "../../src/bootstrap/providers/view";

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "strata-renderer-"));
  await mkdir(join(directory, "layouts"));
  await writeFile(join(directory, "page.eta"), "<p><%= it.title %></p>");
  await writeFile(
    join(directory, "identity.eta"),
    "<p><%= it.currentUser.email %>:<%= it.app %>:<%= it.cspNonce %>:<%= it.csrfToken %>:<%= it.flash.message %></p>",
  );
  await writeFile(join(directory, "layouts/app.eta"), "<main><%~ it.body %></main>");
  await writeFile(join(directory, "layouts/admin.eta"), "<aside><%~ it.body %></aside>");
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("native HTML responses preserve status and copied headers with explicit layouts", async () => {
  const renderer = new ViewRenderer(new EtaViewEngine(directory), "layouts/admin");
  const headers = new Headers({ "X-Page": "admin", "Content-Type": "application/json" });
  const response = await renderer.render(
    "page",
    { title: "<script>" },
    { status: 422, statusText: "Invalid", headers },
  );
  expect(response.status).toBe(422);
  expect(response.statusText).toBe("Invalid");
  expect(response.headers.get("X-Page")).toBe("admin");
  expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  expect(headers.get("Content-Type")).toBe("application/json");
  expect(await response.text()).toBe("<aside><p>&lt;script&gt;</p></aside>");
  expect(
    await (await renderer.render("page", { title: "Full" }, { layout: "layouts/app" })).text(),
  ).toBe("<main><p>Full</p></main>");
  expect(
    await (await renderer.render("page", { title: "Partial" }, { layout: false })).text(),
  ).toBe("<p>Partial</p>");
  expect(
    await (
      await new ViewRenderer(new EtaViewEngine(directory)).render("page", { title: "Default" })
    ).text(),
  ).toBe("<main><p>Default</p></main>");
  expect(
    await (
      await new ViewRenderer(new EtaViewEngine(directory), false).render("page", { title: "Bare" })
    ).text(),
  ).toBe("<p>Bare</p>");
});

test("template failures propagate instead of producing a successful blank page", async () => {
  const renderer = new ViewRenderer(new EtaViewEngine(directory));
  await expect(renderer.render("missing")).rejects.toThrow();
});

test("two app providers and interleaved requests retain isolated shared data", async () => {
  const previousMode = process.env.FRONTEND_MODE;
  process.env.FRONTEND_MODE = "server-htmx";
  try {
    const containers = [new ServiceContainer(), new ServiceContainer()];
    for (const [index, container] of containers.entries()) {
      const provider = createViewProvider({
        directory,
        layout: false,
        data: {
          userKey: "currentUser",
          extra: { app: `app${index}` },
          loadUser: async (_container, request) => {
            if (!request) throw new Error("Expected request context");
            await Bun.sleep(request?.url.endsWith("slow") ? 10 : 1);
            return { email: new URL(request.url).pathname.slice(1) };
          },
        },
      });
      if (!provider.register) throw new Error("Expected view registration");
      await provider.register({
        container,
        config: new ConfigStore(),
        dependencies: { container },
        onCleanup() {},
      });
      expect(container.resolve(CORE_VIEW_TOKEN)).toBeInstanceOf(EtaViewEngine);
    }
    configureWebLayoutData({ extra: { app: "legacy-global" } });
    const result = await Promise.all(
      Array.from({ length: 8 }, (_, index) => {
        const actor = index % 2 ? `actor${index}` : `actor${index}-slow`;
        return runWithRequestMeta(
          {
            ipAddress: null,
            userAgent: null,
            request: new Request(`http://test/${actor}`),
            cspNonce: `nonce${index}`,
            csrfToken: `csrf${index}`,
            flash: { level: "info", message: `flash${index}` },
          },
          async () => {
            const container = containers[index % 2];
            if (!container) throw new Error("Expected app container");
            const renderer = container.resolve(CORE_VIEW_RENDERER_TOKEN);
            return (await renderer.render("identity")).text();
          },
        );
      }),
    );
    result.forEach((body, index) => {
      expect(body).toBe(
        `<p>actor${index}${index % 2 ? "" : "-slow"}:app${index % 2}:nonce${index}:csrf${index}:flash${index}</p>`,
      );
    });
  } finally {
    resetWebLayoutDataConfigForTests();
    if (previousMode === undefined) delete process.env.FRONTEND_MODE;
    else process.env.FRONTEND_MODE = previousMode;
  }
});
