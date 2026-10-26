import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectProviders, createAppContext } from "@getstrata/bootstrap/context";
import {
  clearActiveApplicationContext,
  resolveApplicationConfig,
  setActiveApplicationContext,
} from "@getstrata/core/runtime/applicationRegistry";
import { CORE_VIEW_RENDERER_TOKEN, EtaViewEngine, ViewRenderer } from "@getstrata/core/view";
import { startGuardedApplication } from "../../src/bootstrap/m1/application";
import { routeRegistry } from "../../src/bootstrap/routeRegistry";

const providers = () =>
  collectProviders([]).filter((provider) =>
    ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(
      provider.name,
    ),
  );

test("static module and prefix errors fail before providers run", async () => {
  let acquired = 0;
  const owner = {
    name: "owned",
    register() {
      acquired++;
    },
  };
  await expect(
    startGuardedApplication({ providers: [owner], modules: [{ name: "bad name" }] }),
  ).rejects.toThrow();
  await expect(
    startGuardedApplication({ providers: [owner], modules: [{ name: "same" }, { name: "same" }] }),
  ).rejects.toThrow();
  await expect(
    startGuardedApplication({
      providers: [owner],
      modules: [{ name: "bad", routes: false } as never],
    }),
  ).rejects.toThrow("invalid-factory");
  await expect(
    startGuardedApplication({
      providers: [owner],
      modules: [{ name: "bad", providers: {} } as never],
    }),
  ).rejects.toThrow("invalid-providers");
  await expect(
    startGuardedApplication({ providers: [owner], modules: [], apiPrefix: "/trailing/" }),
  ).rejects.toThrow("invalid-api-prefix");
  expect(acquired).toBe(0);
});
test("a foreign context selected during collection is not disposed by the rejected candidate", async () => {
  const foreign = await createAppContext(providers());
  clearActiveApplicationContext(foreign);
  try {
    await expect(
      startGuardedApplication({
        providers: providers(),
        modules: [
          {
            name: "interference",
            routes() {
              setActiveApplicationContext(foreign);
              return {};
            },
          },
        ],
      }),
    ).rejects.toThrow("context-ownership-changed");
    expect(resolveApplicationConfig()).toBe(foreign.config);
  } finally {
    await foreign.dispose();
  }
});
test("invalid renderer capability is rejected even with prepared artifact data", async () => {
  await expect(
    startGuardedApplication({ providers: providers(), modules: [], documents: {} as never }),
  ).rejects.toThrow("invalid-document-capability");
});
test("OpenAPI metadata is snapshotted before a factory can mutate its input", async () => {
  const openApi = { "/snapshot": { GET: { summary: "captured", tags: ["original"] } } };
  const app = await startGuardedApplication({
    providers: providers(),
    modules: [
      {
        name: "metadata",
        openApi,
        routes() {
          openApi["/snapshot"].GET.summary = "changed";
          openApi["/snapshot"].GET.tags.push("late");
          return { "/snapshot": () => new Response("ok") };
        },
      },
    ],
  });
  try {
    const row = routeRegistry
      .list()
      .find((route) => route.path === "/snapshot" && route.method === "GET");
    expect(row?.openApi?.summary).toBe("captured");
    expect(row?.openApi?.tags).toEqual(["original"]);
    expect(Object.isFrozen(row?.openApi?.tags)).toBe(true);
  } finally {
    expect((await app.shutdown()).successful).toBe(true);
  }
});
test("module providers register and boot once before routes, then follow the existing cleanup phases", async () => {
  const phases: string[] = [];
  const token = "m1.owned-module-value";
  const app = await startGuardedApplication({
    providers: providers(),
    modules: [
      {
        name: "owned-module",
        providers: [
          {
            name: "module-service",
            register({ container, onCleanup }) {
              phases.push("register");
              container.set(token, "ready");
              for (const phase of ["drain", "flush", "close"] as const)
                onCleanup(() => {
                  phases.push(phase);
                }, phase);
            },
            boot() {
              phases.push("boot");
            },
          },
        ],
        routes({ dependencies }) {
          phases.push("routes");
          expect(dependencies.container.resolve(token)).toBe("ready");
          return {};
        },
      },
    ],
  });
  expect(phases).toEqual(["register", "boot", "routes"]);
  expect((await app.shutdown()).successful).toBe(true);
  expect(phases).toEqual(["register", "boot", "routes", "drain", "flush", "close"]);
});
test("stages once, preserves native parameters/HEAD/OPTIONS/admission, then restores prior metadata", async () => {
  routeRegistry.clear();
  routeRegistry.register({ method: "GET", path: "/before", middleware: [] });
  let factories = 0;
  let handled = 0;
  let admitted = 0;
  const app = await startGuardedApplication({
    providers: providers(),
    modules: [
      {
        name: "notes",
        routes: () => {
          factories++;
          expect(routeRegistry.list()[0]?.path).toBe("/before");
          return {
            "/notes/:id": {
              GET: (request) => {
                handled++;
                return Response.json({ id: request.params.id, method: request.method });
              },
            },
            "/static": new Response("static"),
          };
        },
      },
    ],
    transport: {
      onRequest(request) {
        admitted++;
        if (request.headers.has("x-deny")) return new Response("denied", { status: 403 });
      },
    },
  });
  try {
    expect(factories).toBe(1);
    const url = new URL("/notes/100%25", app.server.url);
    expect(await (await fetch(url)).json()).toEqual({ id: "100%", method: "GET" });
    const head = await fetch(url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const before = handled;
    expect((await fetch(url, { method: "OPTIONS" })).status).toBe(204);
    expect(handled).toBe(before);
    expect((await fetch(url, { headers: { "x-deny": "1" } })).status).toBe(403);
    expect(handled).toBe(before);
    expect(admitted).toBe(4);
    expect(await (await fetch(new URL("/static", app.server.url))).text()).toBe("static");
    expect(app.declarations[0]?.effectiveMethods).toEqual(["GET", "HEAD", "OPTIONS"]);
    expect(
      routeRegistry.list().some((row) => row.path === "/notes/:id" && row.method === "HEAD"),
    ).toBe(true);
    await expect(startGuardedApplication({ providers: providers(), modules: [] })).rejects.toThrow(
      "already active",
    );
  } finally {
    expect((await app.shutdown()).successful).toBe(true);
  }
  expect(routeRegistry.list()).toEqual([{ method: "GET", path: "/before", middleware: [] }]);
  routeRegistry.clear();
  expect(() => resolveApplicationConfig()).toThrow("not been bootstrapped");
});
test("collisions, invalid declarations and missing document capability leave baseline intact and permit corrected retry", async () => {
  routeRegistry.clear();
  routeRegistry.register({ method: "GET", path: "/baseline", middleware: [] });
  let calls = 0;
  let closed = 0;
  const extra = {
    name: "owned",
    register({ onCleanup }: import("@getstrata/bootstrap/contracts").ProviderContext) {
      onCleanup(() => {
        closed++;
      });
    },
  };
  await expect(
    startGuardedApplication({
      providers: [...providers(), extra],
      modules: [
        {
          name: "one",
          routes: () => {
            calls++;
            return { "/dupe/:id": { GET: () => new Response() } };
          },
        },
        {
          name: "two",
          routes: () => {
            calls++;
            return { "/dupe/:slug": { POST: () => new Response() } };
          },
        },
      ],
    }),
  ).rejects.toThrow("route-collision");
  expect(calls).toBe(2);
  expect(closed).toBe(1);
  expect(routeRegistry.list()[0]?.path).toBe("/baseline");
  await expect(
    startGuardedApplication({
      providers: providers(),
      modules: [{ name: "web", webRoutes: () => ({ "/": () => new Response() }) }],
    }),
  ).rejects.toThrow("missing-document-capability");
  const corrected = await startGuardedApplication({ providers: providers(), modules: [] });
  expect((await corrected.shutdown()).successful).toBe(true);
  routeRegistry.clear();
});
test("a real bind failure preserves its cause, disposes providers and restores owned metadata", async () => {
  routeRegistry.clear();
  routeRegistry.register({ method: "GET", path: "/before-bind", middleware: [] });
  const occupied = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("occupied"),
  });
  if (!occupied.port) throw new Error("No port");
  let closed = 0;
  try {
    await expect(
      startGuardedApplication({
        providers: [
          ...providers(),
          {
            name: "owned",
            register({ onCleanup }) {
              onCleanup(() => {
                closed++;
              });
            },
          },
        ],
        modules: [{ name: "api", routes: () => ({ "/candidate": () => new Response() }) }],
        transport: { port: occupied.port },
      }),
    ).rejects.toThrow(/Failed to start server|EADDRINUSE|port.*use/i);
    expect(closed).toBe(1);
    expect(routeRegistry.list()[0]?.path).toBe("/before-bind");
    expect(await (await fetch(occupied.url)).text()).toBe("occupied");
    const retry = await startGuardedApplication({ providers: providers(), modules: [] });
    expect((await retry.shutdown()).successful).toBe(true);
  } finally {
    await occupied.stop(true);
    routeRegistry.clear();
  }
});
test("real Eta renderer receives same-build safe script data and web context uses real kernel/cache", async () => {
  const directory = await mkdtemp(join(tmpdir(), "m1-views-"));
  await writeFile(
    join(directory, "page.eta"),
    '<!doctype html><script type="importmap" nonce="owned"><%~ it.publicArtifacts.importMapJson %></script><p><%= it.message %></p>',
  );
  const integrity = `sha256-${Buffer.alloc(32).toString("base64")}`;
  const app = await startGuardedApplication({
    providers: [
      ...providers(),
      {
        name: "actual-view",
        register({ container }) {
          container.set(
            CORE_VIEW_RENDERER_TOKEN,
            new ViewRenderer(new EtaViewEngine(directory), false),
          );
        },
      },
    ],
    artifacts: {
      manifest: {
        format: 1,
        buildId: "A",
        artifacts: {
          main: { relativePath: "entry.js", mediaType: "text/javascript", bytes: 0, integrity },
        },
      },
      policy: { origin: "https://assets.example.test", releasePrefix: "/A/" },
      document: { buildId: "A", entryScripts: ["main"], windowModules: ["main"], stylesheets: [] },
    },
    modules: [
      {
        name: "web",
        webRoutes: ({ documents, cachedJson, kernel }) => {
          expect(typeof cachedJson).toBe("function");
          expect(typeof kernel.wrapPublicDocument).toBe("function");
          return {
            "/page": () =>
              documents.render("page", {
                message: "<private>",
                publicArtifacts: { importMapJson: "</script>bad" },
              }),
            "/fragment": () => documents.renderHtmx("page", { message: "fragment" }),
          };
        },
      },
    ],
  });
  try {
    const html = await (await fetch(new URL("/page", app.server.url))).text();
    expect(html).toContain("&lt;private&gt;");
    expect(html).not.toContain("</script>bad");
    expect(html).toContain("https://assets.example.test/A/entry.js");
    expect(await (await fetch(new URL("/fragment", app.server.url))).text()).toContain("fragment");
  } finally {
    await app.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("metadata hook failure restores baseline and propagates its original error", async () => {
  routeRegistry.clear();
  routeRegistry.register({ method: "GET", path: "/baseline", middleware: [] });
  const register = routeRegistry.register;
  const original = new Error("owned-hook-failure");
  routeRegistry.register = function (row) {
    if (row.path === "/candidate") throw original;
    return register.call(this, row);
  };
  try {
    await expect(
      startGuardedApplication({
        providers: providers(),
        modules: [{ name: "candidate", routes: () => ({ "/candidate": () => new Response() }) }],
      }),
    ).rejects.toBe(original);
  } finally {
    routeRegistry.register = register;
  }
  expect(routeRegistry.list()[0]?.path).toBe("/baseline");
  const next = await startGuardedApplication({ providers: providers(), modules: [] });
  expect((await next.shutdown()).successful).toBe(true);
  routeRegistry.clear();
});
