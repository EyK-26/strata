/** Opt-in integration of the LOCAL M1 prototype; finite public delivery fixture only. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { collectProviders } from "@getstrata/bootstrap/context";
import {
  collectPublicArtifactManifest,
  startGuardedApplication,
  verifyPublicArtifactFiles,
} from "@getstrata/bootstrap/m1";
import { configureContentSecurityPolicy } from "@getstrata/core/http/contentSecurityPolicy";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { EtaViewEngine, ViewRenderer } from "@getstrata/core/view";
import { type Browser, chromium, firefox, type Page, webkit } from "playwright";
import { closeDatabase, getDatabase } from "../src/db/connection";

const output = process.argv[2];
assert.ok(output);
const browserName = process.argv[3] ?? "chromium";
assert.ok(browserName === "chromium" || browserName === "firefox" || browserName === "webkit");
assert.ok(process.env.DATABASE_URL, "Use the run's disposable framework fixture.");
const root = resolve(output);
await mkdir(root);
getDatabase();
const wire = new Map<string, { bytes: Uint8Array; mediaType: string }>();
const requests: { path: string; cookie: boolean; authorization: boolean }[] = [];
let appOrigin = "";
let tamperedPath: string | undefined;
let app: Awaited<ReturnType<typeof startGuardedApplication>> | undefined;
let browser: Browser | undefined;
const publicServer = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    const asset = wire.get(path);
    requests.push({
      path,
      cookie: request.headers.has("cookie"),
      authorization: request.headers.has("authorization"),
    });
    if (!asset) return new Response("missing", { status: 404 });
    const bytes =
      path === tamperedPath
        ? Buffer.from(new TextDecoder().decode(asset.bytes).replace("lazy-", "altered-"))
        : asset.bytes;
    return new Response(bytes, {
      headers: {
        "Content-Type": asset.mediaType,
        "Access-Control-Allow-Origin": appOrigin,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public,max-age=31536000,immutable",
      },
    });
  },
});
const origin = `http://127.0.0.1:${publicServer.port}`;
configureContentSecurityPolicy({
  directives: { "script-src": [origin], "style-src": [origin], "connect-src": ["'self'"] },
});
const base = () =>
  collectProviders([]).filter((provider) =>
    ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(
      provider.name,
    ),
  );
type Build = Awaited<ReturnType<typeof build>>;
async function build(label: string) {
  const input = join(root, label);
  await mkdir(input);
  await writeFile(
    join(input, "entry.ts"),
    `document.body.dataset.build=${JSON.stringify(label)};document.querySelector('#load').addEventListener('click',()=>import('./lazy.ts').then(m=>document.body.dataset.lazy=m.value).catch(()=>document.body.dataset.lazy='rejected'));fetch('/api/data').then(r=>r.json()).then(v=>document.body.dataset.api=v.build);`,
  );
  await writeFile(join(input, "lazy.ts"), `export const value=${JSON.stringify(`lazy-${label}`)};`);
  await writeFile(join(input, "style.css"), "body{color:rgb(12,34,56)}");
  const directory = join(input, "output");
  const built = await Bun.build({
    entrypoints: [join(input, "entry.ts"), join(input, "style.css")],
    outdir: directory,
    splitting: true,
    target: "browser",
    publicPath: `${origin}/releases/${label}/`,
    naming: { entry: "[name]-[hash].[ext]", chunk: "chunk-[hash].[ext]" },
  });
  assert.ok(built.success);
  const selected = built.outputs.map((asset) => ({
    logicalName: basename(asset.path),
    outputPath: asset.path,
  }));
  const manifest = await collectPublicArtifactManifest({
    buildId: label,
    outputDirectory: directory,
    outputs: built.outputs,
    selected,
  });
  await verifyPublicArtifactFiles(manifest, directory);
  for (const asset of built.outputs)
    wire.set(`/releases/${label}/${basename(asset.path)}`, {
      bytes: new Uint8Array(await asset.arrayBuffer()),
      mediaType: asset.type,
    });
  const entry = selected.find((asset) => asset.logicalName.startsWith("entry-"));
  const style = selected.find((asset) => asset.logicalName.startsWith("style-"));
  const lazy = selected.find((asset) => asset.logicalName.startsWith("chunk-"));
  assert.ok(entry && style && lazy);
  const plan = {
    buildId: label,
    entryScripts: [entry.logicalName],
    windowModules: selected
      .filter((asset) => asset.logicalName.endsWith(".js"))
      .map((asset) => asset.logicalName),
    stylesheets: [style.logicalName],
  };
  return {
    label,
    manifest,
    plan,
    lazyPath: `/releases/${label}/${lazy.logicalName}`,
    directory,
    built,
  };
}
const observations: Record<string, unknown>[] = [];
async function start(value: Build, port = 0) {
  const current = await startGuardedApplication({
    providers: base(),
    documents: new ViewRenderer(new EtaViewEngine(root), false),
    artifacts: {
      manifest: value.manifest,
      policy: { origin, releasePrefix: `/releases/${value.label}/` },
      allowHttpLoopback: true,
      document: value.plan,
    },
    modules: [
      {
        name: "data",
        routes: () => ({ "/api/data": () => Response.json({ build: value.label }) }),
      },
      {
        name: "document",
        webRoutes: ({ documents }) => ({
          "/page": () => documents.render("page", { nonce: currentRequestMeta().cspNonce }),
        }),
      },
    ],
    transport: {
      port,
      onRequest(request) {
        if (!(request.headers.get("cookie") ?? "").includes("m1-owned=1"))
          return new Response("denied", { status: 403 });
      },
    },
  });
  appOrigin = `http://localhost:${current.server.port}`;
  return current;
}
async function ready(page: Page, key: string, expected: string) {
  for (let n = 0; n < 400; n++) {
    if ((await page.locator("body").getAttribute(`data-${key}`)) === expected) return;
    await Bun.sleep(25);
  }
  assert.fail(`${key} did not become ${expected}`);
}
try {
  await writeFile(
    join(root, "page.eta"),
    '<!doctype html><html><head><script type="importmap" nonce="<%= it.nonce %>"><%~ it.publicArtifacts.importMapJson %></script><% for(const style of it.publicArtifacts.stylesheets){ %><link rel="stylesheet" href="<%= style.url %>" integrity="<%= style.integrity %>" crossorigin="anonymous"><% } %></head><body><button id="load">Load</button><% for(const script of it.publicArtifacts.entryScripts){ %><script type="module" src="<%= script.url %>" integrity="<%= script.integrity %>" crossorigin="anonymous"></script><% } %></body></html>',
  );
  const A = await build("A");
  const B = await build("B");
  app = await start(A);
  const port = app.server.port;
  assert.ok(port);
  assert.equal((await fetch(`${appOrigin}/page`)).status, 403);
  browser = await { chromium, firefox, webkit }[browserName].launch(
    browserName === "chromium" ? { chromiumSandbox: true } : {},
  );
  const context = await browser.newContext();
  await context.addCookies([{ name: "m1-owned", value: "1", url: appOrigin, httpOnly: true }]);
  const old = await context.newPage();
  await old.goto(`${appOrigin}/page`);
  await ready(old, "build", "A");
  await ready(old, "api", "A");
  assert.equal(await old.evaluate("getComputedStyle(document.body).color"), "rgb(12, 34, 56)");
  observations.push({ case: "guarded-document-native-modules-css-relative-api", passed: true });
  const negative = await browser.newContext();
  await negative.addCookies([{ name: "m1-owned", value: "1", url: appOrigin }]);
  const bad = await negative.newPage();
  tamperedPath = A.lazyPath;
  await bad.goto(`${appOrigin}/page`);
  await ready(bad, "build", "A");
  await bad.click("#load");
  await ready(bad, "lazy", "rejected");
  observations.push({ case: "actual-prototype-map-rejects-altered-lazy-wire-bytes", passed: true });
  await negative.close();
  tamperedPath = undefined;
  assert.equal((await app.shutdown()).successful, true);
  app = await start(B, port);
  const next = await context.newPage();
  await next.goto(`${appOrigin}/page`);
  await ready(next, "build", "B");
  await ready(next, "api", "B");
  await old.click("#load");
  await ready(old, "lazy", "lazy-A");
  assert.equal((await app.shutdown()).successful, true);
  app = await start(A, port);
  const rollback = await context.newPage();
  await rollback.goto(`${appOrigin}/page`);
  await ready(rollback, "build", "A");
  await ready(rollback, "api", "A");
  await next.click("#load");
  await ready(next, "lazy", "lazy-B");
  observations.push({
    case: "A-B-A-listener-lifecycle-and-retained-old-window-chunks",
    passed: true,
  });
  assert.ok(requests.every((request) => !request.cookie && !request.authorization));
  for (const value of [A, B]) await verifyPublicArtifactFiles(value.manifest, value.directory);
  await context.close();
  await writeFile(
    join(root, "receipt.json"),
    JSON.stringify(
      {
        status: "BOUNDED_LOCAL_PROTOTYPE_PASSED",
        bun: Bun.version,
        revision: Bun.revision,
        ...(browserName === "chromium" ? { chromium: browser.version() } : {}),
        browserEngine: browserName,
        browserVersion: browser.version(),
        executed: observations.length,
        failed: 0,
        skipped: 0,
        observations,
        publicRequests: requests,
        nativeOutputsUnchanged: true,
        scope: `Uncommitted prototype with native outputs, actual Eta/kernel/provider/lifecycle/HTTP and pinned ${browserName}. Not published-package, all-browser, provider/TLS, whole-asset-graph, populated major migration or native lossless-delivery acceptance.`,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
} catch (error) {
  await writeFile(
    join(root, "failure.json"),
    JSON.stringify({ error: String(error), observations, requests }, null, 2) + "\n",
    { flag: "wx" },
  );
  throw error;
} finally {
  try {
    await browser?.close();
  } finally {
    try {
      await app?.shutdown();
    } finally {
      await app?.server.stop(true);
      await publicServer.stop(true);
      await closeDatabase();
    }
  }
}
