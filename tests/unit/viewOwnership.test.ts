import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplicationContext, type InitializedAppContext } from "@getstrata/bootstrap/context";
import { createCacheProvider } from "@getstrata/bootstrap/providers/cacheProvider";
import { createStorageProvider } from "@getstrata/bootstrap/providers/storage";
import { ValidationError } from "@getstrata/core/errors/http";
import { createWebErrorMiddleware } from "@getstrata/core/http/response";
import { tooManyRequestsResponse } from "@getstrata/core/http/throttleResponse";
import * as view from "@getstrata/core/view";
import { CORE_WEB_ERROR_VIEW_TOKEN } from "@getstrata/core/view/tokens";
import * as providers from "../../src/bootstrap/providers/view";

const roots: string[] = [];
const applications: InitializedAppContext[] = [];
afterAll(async () => {
  await Promise.all(applications.map((app) => app.dispose()));
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function owner(name: string) {
  const root = await mkdtemp(join(tmpdir(), "strata-view-owner-"));
  roots.push(root);
  await mkdir(join(root, "templates/errors"), { recursive: true });
  await mkdir(join(root, "templates/layouts"));
  await writeFile(
    join(root, "templates/layouts/custom.eta"),
    `<main>${name}:<%= it.app %>:<%~ it.body %></main>`,
  );
  for (const template of ["error", "not-found", "forbidden"]) {
    await writeFile(
      join(root, `templates/errors/${template}.eta`),
      `<h1>${name}:${template}:<%= it.message %></h1>`,
    );
  }
  const data = { extra: { app: name } };
  const options = {
    enabled: true,
    rootDir: root,
    directory: "templates",
    layout: "layouts/custom",
    data,
  };
  const provider = providers.createViewProvider(options);
  // Neither caller mutation nor later environment changes can retarget this owner.
  options.directory = "missing";
  options.enabled = false;
  data.extra.app = "mutated";
  const app = await createApplicationContext(
    [
      createCacheProvider({ CACHE_DRIVER: "array" }),
      createStorageProvider({
        put: async (path) => path,
        get: async () => null,
        delete: async () => false,
      }),
      provider,
    ],
    { connection: "main", definition: { services: [], providers: [] } },
  ).start();
  applications.push(app);
  return app.container.resolve(CORE_WEB_ERROR_VIEW_TOKEN);
}

test("custom error templates, layouts, and owner data remain isolated across interleaved requests", async () => {
  const first = await owner("first");
  const second = await owner("second");
  const previousDirectory = process.env.VIEW_DIRECTORY;
  const previousMode = process.env.FRONTEND_MODE;
  process.env.VIEW_DIRECTORY = "/definitely/missing";
  process.env.FRONTEND_MODE = "api";
  try {
    const responses = await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const name = i % 2 ? "second" : "first";
        const middleware = createWebErrorMiddleware({
          enabled: true,
          render: i % 2 ? second : first,
        });
        const response = await middleware(
          new Request(`https://${name}.test/profile`, { headers: { accept: "text/html" } }),
          async () => {
            await Bun.sleep(i % 2 ? 1 : 8);
            if (i < 6) throw new ValidationError(`message${i}`);
            return tooManyRequestsResponse(
              new Request(`https://${name}.test/limit`, { headers: { accept: "text/html" } }),
              `message${i}`,
              17,
            );
          },
        );
        expect(response.status).toBe(i < 6 ? 422 : 429);
        expect(response.headers.get("cache-control")).toBe("no-store");
        if (i >= 6) expect(response.headers.get("retry-after")).toBe("17");
        expect(await response.text()).toBe(
          `<main>${name}:${name}:<h1>${name}:error:message${i}</h1></main>`,
        );
        return response;
      }),
    );
    expect(responses).toHaveLength(8);
    const missing = await view.notFoundHtmlResponse(undefined, first);
    expect(await missing.text()).toBe(
      "<main>first:first:<h1>first:not-found:The page you requested was not found.</h1></main>",
    );
  } finally {
    if (previousDirectory === undefined) delete process.env.VIEW_DIRECTORY;
    else process.env.VIEW_DIRECTORY = previousDirectory;
    if (previousMode === undefined) delete process.env.FRONTEND_MODE;
    else process.env.FRONTEND_MODE = previousMode;
  }
});

test("missing and failed owned templates use escaped safe chrome without borrowing another owner", async () => {
  const custom = await owner("custom");
  const broken = view.createWebErrorView({
    render: () => {
      throw new Error("missing template");
    },
  });
  const input = {
    status: 422,
    title: "<unsafe>",
    message: "<script>",
    request: new Request("https://app.test/post", {
      method: "POST",
      headers: { referer: "https://evil.test/private?secret=1" },
    }),
  };
  const [customHtml, safeHtml, defaultHtml] = await Promise.all([
    custom(input),
    broken(input),
    view.renderWebErrorHtml(input),
  ]);
  expect(customHtml).toContain("custom:custom");
  for (const html of [safeHtml, defaultHtml]) {
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href="/">Go back');
    expect(html).not.toContain("custom:custom");
    expect(html).not.toContain("evil.test");
    expect(html).not.toContain("<script>");
  }
  expect("configureWebErrorView" in view).toBe(false);
  expect("configureWebLayoutData" in view).toBe(false);
  expect("viewProvider" in providers).toBe(false);
});

test("two transports render their own missing assets and null routes with isolated safe defaults", async () => {
  const { createWebServer } = await import("@getstrata/bootstrap/web/server");
  const first = await owner("transport-first");
  const second = await owner("transport-second");
  const servers = [first, second, undefined].map((errorView) =>
    createWebServer({
      port: 0,
      native: { hostname: "127.0.0.1" },
      errorView,
      routes: { "/gone": async () => null },
    }),
  );
  try {
    await Promise.all(
      servers.flatMap((server, index) =>
        ["/gone", "/assets/missing.css", "/missing"].map(async (path) => {
          const response = await fetch(`http://127.0.0.1:${server.port}${path}`);
          expect(response.status).toBe(404);
          expect(response.headers.get("cache-control")).toBe("no-store");
          const body = await response.text();
          if (index < 2) {
            const name = index ? "transport-second" : "transport-first";
            expect(body).toBe(
              `<main>${name}:${name}:<h1>${name}:not-found:The page you requested was not found.</h1></main>`,
            );
            expect(body).not.toContain(index ? "transport-first" : "transport-second");
          } else {
            expect(body).toContain("<!doctype html>");
            expect(body).not.toContain("transport-first");
            expect(body).not.toContain("transport-second");
          }
        }),
      ),
    );
  } finally {
    await Promise.all(servers.map((server) => server.stop(true)));
  }
});
