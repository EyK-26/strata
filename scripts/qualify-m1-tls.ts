/** Opt-in owned Linux/nginx/TLS qualification. Never deploys or selects a provider. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { connect } from "node:tls";
import { collectProviders } from "@getstrata/bootstrap/context";
import {
  collectPublicArtifactManifest,
  startGuardedApplication,
  verifyPublicArtifactFiles,
} from "@getstrata/bootstrap/m1";
import { configureContentSecurityPolicy } from "@getstrata/core/http/contentSecurityPolicy";
import { resolveCsrfTokenForRequest } from "@getstrata/core/http/csrfToken";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { EtaViewEngine, textResponse, ViewRenderer } from "@getstrata/core/view";
import { type BrowserContext, chromium, firefox, webkit } from "playwright";
import { closeDatabase, getDatabase } from "../src/db/connection";

const root = process.argv[2];
assert.ok(root);
const publicOrigin = "https://assets.m1-assets.test";
const appOrigin = "https://app.m1-app.test";
process.env.CSRF_TARGET_ORIGIN = appOrigin;
process.env.APP_URL = appOrigin;
process.env.TENANCY_DRIVER = "none";
getDatabase();
await mkdir(join(root, "files", "releases", "A"), { recursive: true });
await mkdir(join(root, "views"), { recursive: true });
const input = join(root, "input");
await mkdir(input, { recursive: true });
await writeFile(
  join(input, "entry.ts"),
  "document.body.dataset.loaded='native';fetch('/api/data').then(r=>r.json()).then(v=>document.body.dataset.api=v.value);",
);
await writeFile(join(input, "style.css"), "body{color:rgb(12,34,56)}");
const directory = join(root, "files", "releases", "A");
const built = await Bun.build({
  entrypoints: [join(input, "entry.ts"), join(input, "style.css")],
  outdir: directory,
  target: "browser",
  publicPath: `${publicOrigin}/releases/A/`,
  naming: "[name]-[hash].[ext]",
});
assert.ok(built.success);
const selected = built.outputs.map((value) => ({
  logicalName: basename(value.path),
  outputPath: value.path,
}));
const manifest = await collectPublicArtifactManifest({
  buildId: "A",
  outputDirectory: directory,
  outputs: built.outputs,
  selected,
});
const entry = selected.find((value) => value.logicalName.endsWith(".js"));
const style = selected.find((value) => value.logicalName.endsWith(".css"));
assert.ok(entry && style);
const large = join(root, "files", "large.bin");
const largeBytes = Buffer.alloc(70 * 1024 * 1024, 42);
await writeFile(large, largeBytes);
await writeFile(join(root, "files", "compress.txt"), "owned gzip representation\n".repeat(4096));
await writeFile(
  join(root, "views", "page.eta"),
  '<!doctype html><html><head><script type="importmap" nonce="<%= it.nonce %>"><%~ it.publicArtifacts.importMapJson %></script><% for(const style of it.publicArtifacts.stylesheets){ %><link rel="stylesheet" href="<%= style.url %>" integrity="<%= style.integrity %>" crossorigin="anonymous"><% } %></head><body><form method="post" action="/page"><input name="_token" value="<%= it.token %>"><input name="value" value="Český příspěvek"><button>Send</button></form><% for(const script of it.publicArtifacts.entryScripts){ %><script type="module" src="<%= script.url %>" integrity="<%= script.integrity %>" crossorigin="anonymous"></script><% } %></body></html>',
);
configureContentSecurityPolicy({
  directives: {
    "script-src": [publicOrigin],
    "style-src": [publicOrigin],
    "connect-src": ["'self'"],
    "form-action": ["'self'"],
  },
});
let posts = 0;
const observations: { case: string; passed: true; detail?: unknown }[] = [];
const pass = (name: string, detail?: unknown) => {
  observations.push({ case: name, passed: true, ...(detail ? { detail } : {}) });
  console.log(`PASS ${name}`);
};
const app = await startGuardedApplication({
  providers: collectProviders([]).filter((p) =>
    ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(p.name),
  ),
  documents: new ViewRenderer(new EtaViewEngine(join(root, "views")), false),
  artifacts: {
    manifest,
    policy: { origin: publicOrigin, releasePrefix: "/releases/A/" },
    document: {
      buildId: "A",
      entryScripts: [entry.logicalName],
      windowModules: [entry.logicalName],
      stylesheets: [style.logicalName],
    },
  },
  transport: { port: 39001, native: { hostname: "0.0.0.0" } },
  modules: [
    { name: "api", routes: () => ({ "/api/data": () => Response.json({ value: "relative" }) }) },
    {
      name: "form",
      webRoutes: ({ documents }) => ({
        "/page": {
          GET: (request) =>
            documents.render("page", {
              nonce: currentRequestMeta().cspNonce,
              token: resolveCsrfTokenForRequest(request),
            }),
          POST: async (request) => {
            posts++;
            return textResponse(`accepted:${(await request.formData()).get("value")}`);
          },
        },
      }),
    },
  ],
});
const contexts: BrowserContext[] = [];
const ca = await readFile(join(root, "ca.crt"), "utf8");
const tls = { ca };
try {
  await writeFile(join(root, "ready.json"), JSON.stringify({ ready: true }));
  for (let attempt = 0; ; attempt++) {
    try {
      const observed = await fetch(`${appOrigin}/page`, { tls });
      if (observed.ok) break;
      if (attempt === 99) console.error("Ingress status", observed.status, await observed.text());
    } catch (error) {
      if (attempt === 99) console.error("Ingress connection failure", error);
    }
    if (attempt === 100) throw new Error("Owned nginx ingress did not start");
    await Bun.sleep(100);
  }
  for (const engine of ["chromium", "firefox", "webkit"] as const) {
    const profile = join(root, `profile-${engine}`);
    await mkdir(profile, { recursive: true });
    if (engine === "firefox") {
      for (const args of [
        ["-N", "--empty-password", "-d", `sql:${profile}`],
        [
          "-A",
          "-d",
          `sql:${profile}`,
          "-n",
          "M1 owned CA",
          "-t",
          "C,,",
          "-i",
          join(root, "ca.crt"),
        ],
      ]) {
        const result: Bun.SyncSubprocess = Bun.spawnSync(["certutil", ...args]);
        assert.equal(result.exitCode, 0, result.stderr?.toString() ?? "");
      }
    }
    const context: BrowserContext = await { chromium, firefox, webkit }[
      engine
    ].launchPersistentContext(profile, engine === "chromium" ? { chromiumSandbox: true } : {});
    contexts.push(context);
    const assetRequests: { cookie: boolean; authorization: boolean }[] = [];
    context.on("request", (request) => {
      if (request.url().startsWith(publicOrigin)) {
        const headers = request.headers();
        assetRequests.push({ cookie: !!headers.cookie, authorization: !!headers.authorization });
      }
    });
    const page = await context.newPage();
    const documentResponse = await page.goto(`${appOrigin}/page`);
    assert.ok(documentResponse);
    const nonce = /'nonce-([^']+)'/.exec(
      documentResponse.headers()["content-security-policy"] ?? "",
    )?.[1];
    assert.ok(nonce);
    assert.ok((await documentResponse.text()).includes(`nonce="${nonce}"`));
    for (let i = 0; ; i++) {
      if (
        (await page.locator("body").getAttribute("data-loaded")) === "native" &&
        (await page.locator("body").getAttribute("data-api")) === "relative"
      )
        break;
      assert.ok(i < 200, "Native entry and relative API must execute under CSP");
      await Bun.sleep(25);
    }
    assert.equal(await page.evaluate("getComputedStyle(document.body).color"), "rgb(12, 34, 56)");
    const cookies = await context.cookies(appOrigin);
    assert.ok(cookies.some((cookie) => cookie.httpOnly && cookie.sameSite === "Lax"));
    const token = await page.locator('input[name="_token"]').inputValue();
    assert.ok(token);
    assert.equal(await page.locator('input[name="value"]').inputValue(), "Český příspěvek");
    const [submitted] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url() === `${appOrigin}/page` && response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Send" }).click(),
    ]);
    assert.equal(submitted.status(), 200);
    assert.match(submitted.headers()["content-type"] ?? "", /text\/plain; charset=utf-8/);
    await writeFile(
      join(root, `post-${engine}.json`),
      JSON.stringify(
        {
          headers: await submitted.allHeaders(),
          sent: submitted.request().postData(),
          url: page.url(),
          pages: context.pages().map((p) => p.url()),
          document: await page.content(),
        },
        null,
        2,
      ),
    );
    await page.getByText("accepted:Český příspěvek", { exact: true }).waitFor();
    assert.ok(assetRequests.length >= 2);
    assert.ok(assetRequests.every((request) => !request.cookie && !request.authorization));
    pass(`${engine}-validated-TLS-native-Eta-CSP-CORS-cookie-form-relative-API`, {
      assetRequests: assetRequests.length,
    });
    await context.close();
  }
  const get = await fetch(`${appOrigin}/page`, { tls });
  const html = await get.text();
  const token = /name="_token" value="([^"]+)"/.exec(html)?.[1];
  const cookie = get.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.ok(token && cookie);
  const headers = { cookie, origin: appOrigin, "x-csrf-token": token };
  for (const [name, overrides] of [
    ["missing-token", { "x-csrf-token": "" }],
    ["invalid-token", { "x-csrf-token": "wrong" }],
    ["cross-origin", { origin: publicOrigin }],
    ["malformed-origin", { origin: `${appOrigin}, https://evil.test` }],
    ["conflicting-origin", { origin: `${appOrigin}/path` }],
  ] as const) {
    const before = posts;
    const response = await fetch(`${appOrigin}/page`, {
      method: "POST",
      headers: { ...headers, ...overrides },
      tls,
    });
    assert.equal(response.status, 403, name);
    assert.equal(posts, before);
    pass(`TLS-${name}-rejected`);
  }
  const spoof = await fetch(`${appOrigin}/page`, {
    method: "POST",
    headers: {
      ...headers,
      "x-forwarded-proto": "http",
      "x-forwarded-host": "evil.test",
      forwarded: "host=evil.test;proto=http",
    },
    body: new URLSearchParams({ value: "Český příspěvek" }),
    tls,
  });
  assert.equal(spoof.status, 200); // Controlled ingress overwrites forwarding; configured origin does not trust it.
  pass("TLS-ingress-overwrites-spoofed-forwarding");
  const direct = await fetch("http://127.0.0.1:39001/page", {
    headers: { "x-forwarded-host": "app.m1-app.test", "x-forwarded-proto": "https" },
  });
  assert.equal(direct.status, 403);
  pass("direct-backend-wrong-host-not-admitted-by-forwarding");
  const conflict = await fetch(`${appOrigin}/page`, { headers: { Host: "evil.test" }, tls });
  assert.equal(conflict.status, 421);
  pass("TLS-ingress-unknown-Host-rejected");
  const certificateFailure = await new Promise<NodeJS.ErrnoException>((resolve, reject) => {
    const socket = connect(
      { host: "assets.m1-assets.test", port: 443, servername: "wrong.m1.test", ca },
      () => {
        socket.destroy();
        reject(new Error("Wrong-host certificate was accepted"));
      },
    );
    socket.once("error", resolve);
  });
  assert.equal(certificateFailure.code, "ERR_TLS_CERT_ALTNAME_INVALID");
  pass("TLS-bad-certificate-host-rejected");
  const assetUrl = `${publicOrigin}/releases/A/${entry.logicalName}`;
  const full = await fetch(assetUrl, { headers: { origin: appOrigin }, tls });
  const bytes = Buffer.from(await full.arrayBuffer());
  assert.deepEqual(bytes, await readFile(join(directory, entry.logicalName)));
  assert.match(full.headers.get("content-type") ?? "", /javascript/);
  assert.equal(full.headers.get("access-control-allow-origin"), appOrigin);
  assert.equal(full.headers.get("access-control-allow-credentials"), null);
  assert.equal(full.headers.get("set-cookie"), null);
  assert.equal(full.headers.get("x-content-type-options"), "nosniff");
  assert.match(full.headers.get("cache-control") ?? "", /immutable/);
  const head = await fetch(assetUrl, {
    method: "HEAD",
    headers: { "accept-encoding": "identity" },
    tls,
  });
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal(Number(head.headers.get("content-length")), bytes.length);
  const ranged = await fetch(assetUrl, {
    headers: { range: "bytes=0-7", "accept-encoding": "identity" },
    tls,
  });
  assert.equal(ranged.status, 206);
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), bytes.subarray(0, 8));
  assert.equal(
    (
      await fetch(assetUrl, {
        headers: { range: "bytes=999999999-", "accept-encoding": "identity" },
        tls,
      })
    ).status,
    416,
  );
  const etag = full.headers.get("etag");
  assert.ok(etag);
  assert.equal((await fetch(assetUrl, { headers: { "if-none-match": etag }, tls })).status, 304);
  assert.equal((await fetch(`${publicOrigin}/missing`, { tls })).status, 404);
  assert.equal((await fetch(assetUrl, { method: "POST", tls })).status, 403);
  pass("TLS-nginx-MIME-bytes-CORS-cache-HEAD-ranges-conditionals-methods-missing");
  const compressed = await fetch(`${publicOrigin}/compress.txt`, {
    headers: { "accept-encoding": "gzip" },
    tls,
  });
  assert.equal(compressed.headers.get("content-encoding"), "gzip");
  assert.deepEqual(
    Buffer.from(await compressed.arrayBuffer()),
    await readFile(join(root, "files", "compress.txt")),
  );
  pass("TLS-gzip-decoded-delivery-bytes-equal-retained-input");
  const redirected = await fetch(`${publicOrigin}/redirect`, { redirect: "manual", tls });
  assert.equal(redirected.status, 302);
  assert.equal(redirected.headers.get("location"), assetUrl);
  assert.deepEqual(
    Buffer.from(await (await fetch(`${publicOrigin}/redirect`, { tls })).arrayBuffer()),
    bytes,
  );
  pass("TLS-explicit-redirect-observation-and-decoded-target-bytes");
  const abort = new AbortController();
  const partial = await fetch(`${publicOrigin}/slow.bin`, { signal: abort.signal, tls });
  const reader = partial.body?.getReader();
  assert.ok(reader);
  assert.equal((await reader.read()).done, false);
  abort.abort();
  await reader.cancel().catch(() => undefined);
  const big = await fetch(`${publicOrigin}/large.bin`, { tls });
  assert.equal(big.status, 200);
  const delivered = Buffer.from(await big.arrayBuffer());
  assert.equal(delivered.length, largeBytes.length);
  assert.equal(
    createHash("sha256").update(delivered).digest("hex"),
    createHash("sha256").update(largeBytes).digest("hex"),
  );
  pass("TLS-interrupted-transfer-and-70MiB-nginx-delivery", {
    nativeBun64MiBLimitNotChanged: true,
  });
  await verifyPublicArtifactFiles(manifest, directory);
  await writeFile(
    join(root, "receipt.json"),
    JSON.stringify(
      {
        status: "LOCAL_TLS_QUALIFIED",
        executed: observations.length,
        failed: 0,
        skipped: 0,
        observations,
        scope:
          "Owned nginx TLS-offload and static delivery, official pinned browser engines, container-owned CA trust only; not a hosted provider or shipping-browser acceptance.",
      },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile(
    join(root, "failure.json"),
    JSON.stringify({ error: String(error), observations }, null, 2),
  );
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await app.shutdown();
  await app.server.stop(true);
  await closeDatabase();
}
