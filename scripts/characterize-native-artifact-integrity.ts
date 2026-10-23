import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { chromium } from "playwright";

// Opt-in SDK/browser characterization, not a framework route or delivery adapter.
// Keep native outputs unchanged. Deliberately altered wire bytes are negative controls.
const evidenceDir = process.argv[2];
assert.ok(
  evidenceDir,
  "Pass a new, owned evidence directory; previous receipts are never overwritten.",
);
const root = resolve(evidenceDir);
await mkdir(root);
const digest = (bytes: Uint8Array) =>
  `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
const sourceIntegrity = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const script = `document.body.dataset.executed = "original";
fetch("/api/probe", { credentials: "include" }).then(r => r.text()).then(value => {
  document.body.dataset.api = value;
});`;
const css = "body { color: rgb(12, 34, 56); }";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="7" height="5"><path fill="red" d="M0 0h7v5H0z"/></svg>';
type Asset = { body: Uint8Array; type: string };
type BrowserState = {
  executed: string | null;
  api: string | null;
  chunk: string | null;
  color: string;
  images: { width: number; height: number }[];
  scripts: { integrity: string; crossOrigin: string | null }[];
  styles: { integrity: string; crossOrigin: string | null }[];
};
const artifacts = new Map<string, Asset>();
const alteredChunks = new Set<string>();
// Sequential wire-negative controls, never a production manifest/publisher pointer.
let tamperChunks = true;
const assetRequests: { path: string; cookie: boolean; authorization: boolean }[] = [];
const assets = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    assetRequests.push({
      path,
      cookie: request.headers.has("cookie"),
      authorization: request.headers.has("authorization"),
    });
    const asset = artifacts.get(path);
    if (!asset) return new Response("missing", { status: 404 });
    const noCors = path.startsWith("/no-cors/");
    const scriptTamper = path.startsWith("/script-tamper/") || path.startsWith("/native-tamper/");
    const cssTamper = path.startsWith("/style-tamper/");
    let body = asset.body;
    if (scriptTamper && asset.type === "text/javascript") {
      body = new TextEncoder().encode(
        `${new TextDecoder().decode(body)}\ndocument.body.dataset.executed = "tampered";`,
      );
    }
    if (cssTamper && asset.type === "text/css") {
      body = new TextEncoder().encode("body { color: rgb(98, 76, 54); }");
    }
    if (tamperChunks && alteredChunks.has(path)) {
      body = new TextEncoder().encode(
        `${new TextDecoder().decode(body)}\ndocument.body.dataset.chunk = "tampered";`,
      );
    }
    return new Response(body, {
      headers: {
        "Content-Type": asset.type,
        "Cache-Control": "no-store",
        ...(noCors ? {} : { "Access-Control-Allow-Origin": "*" }),
      },
    });
  },
});
const assetOrigin = `http://127.0.0.1:${assets.port}`;
const documents = new Map<string, string>();
const importMapNonces = new Map<string, string>();
const apiRequests: { cookie: boolean }[] = [];
const app = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/api/probe") {
      apiRequests.push({
        cookie: request.headers.get("cookie")?.includes("m1-fixture=owned") ?? false,
      });
      return new Response("application-origin");
    }
    const document = documents.get(path);
    if (!document) return new Response("missing", { status: 404 });
    const importMapNonce = importMapNonces.get(path);
    return new Response(document, {
      headers: {
        "Content-Type": "text/html;charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": `default-src 'none'; script-src ${assetOrigin}${importMapNonce ? ` 'nonce-${importMapNonce}'` : ""}; style-src ${assetOrigin}; img-src ${assetOrigin}; connect-src 'self'; base-uri 'none'`,
      },
    });
  },
});
const appOrigin = `http://localhost:${app.port}`;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const observations: unknown[] = [];
try {
  const nativeBuilds = [];
  for (const withSourceIntegrity of [false, true]) {
    const name = withSourceIntegrity ? "source-integrity" : "plain";
    const input = join(root, name, "input");
    await mkdir(input, { recursive: true });
    await writeFile(join(input, "entry.ts"), script);
    await writeFile(join(input, "style.css"), css);
    await writeFile(join(input, "mark.svg"), svg);
    const attrs = withSourceIntegrity
      ? ` integrity="${sourceIntegrity}" crossorigin="anonymous"`
      : "";
    await writeFile(
      join(input, "index.html"),
      `<!doctype html><html><head><link rel="stylesheet" href="./style.css"${attrs}></head><body><img src="./mark.svg" alt="fixture"><script type="module" src="./entry.ts"${attrs}></script></body></html>`,
    );
    const build = await Bun.build({
      entrypoints: [join(input, "index.html")],
      outdir: join(root, name, "output"),
      target: "browser",
      publicPath: `${assetOrigin}/native-tamper/${name}/`,
      naming: { entry: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]" },
    });
    assert.ok(build.success, build.logs.map(String).join("\n"));
    const html = build.outputs.find((output) => output.path.endsWith(".html"));
    assert.ok(html, "Native HTML output required.");
    const document = await html.text();
    documents.set(`/native-${name}`, document);
    const outputs = [];
    for (const output of build.outputs) {
      const body = new Uint8Array(await output.arrayBuffer());
      const type = output.type.split(";")[0] ?? "application/octet-stream";
      if (type !== "text/html") {
        artifacts.set(`/native-tamper/${name}/${basename(output.path)}`, { body, type });
      }
      outputs.push({
        path: relative(root, output.path),
        bytes: body.length,
        integrity: digest(body),
      });
    }
    nativeBuilds.push({ name, html: document, outputs });
  }

  // A separate browser control: author an app-origin document using native-built
  // bytes and their digests. This does not modify any native-generated document.
  const builtScript = [...artifacts.values()].find((asset) => asset.type === "text/javascript");
  const builtStyle = [...artifacts.values()].find((asset) => asset.type === "text/css");
  assert.ok(builtScript);
  assert.ok(builtStyle);
  const cases = ["valid", "script-tamper", "style-tamper", "no-cors"];
  for (const name of cases) {
    artifacts.set(`/${name}/entry.js`, builtScript);
    artifacts.set(`/${name}/style.css`, builtStyle);
    documents.set(
      `/${name}`,
      `<!doctype html><html><head><link rel="stylesheet" href="${assetOrigin}/${name}/style.css" integrity="${digest(builtStyle.body)}" crossorigin="anonymous"></head><body><script type="module" src="${assetOrigin}/${name}/entry.js" integrity="${digest(builtScript.body)}" crossorigin="anonymous"></script></body></html>`,
    );
  }
  const graphInput = join(root, "split-module", "input");
  await mkdir(graphInput, { recursive: true });
  await writeFile(join(graphInput, "entry.ts"), `${script}\nimport("./lazy.ts");`);
  await writeFile(join(graphInput, "lazy.ts"), 'document.body.dataset.chunk = "original";');
  const graph = await Bun.build({
    entrypoints: [join(graphInput, "entry.ts")],
    outdir: join(root, "split-module", "output"),
    target: "browser",
    splitting: true,
    publicPath: `${assetOrigin}/chunk-tamper/`,
    naming: { entry: "[name]-[hash].[ext]", chunk: "[name]-[hash].[ext]" },
  });
  assert.ok(graph.success, graph.logs.map(String).join("\n"));
  const graphEntry = graph.outputs.find((output) => output.kind === "entry-point");
  const graphChunks = graph.outputs.filter((output) => output.kind === "chunk");
  assert.ok(graphEntry);
  assert.ok(graphChunks.length > 0, "A real native split-module output is required.");
  const graphOutputs = [];
  const graphIntegrity: Record<string, string> = {};
  for (const output of graph.outputs) {
    const body = new Uint8Array(await output.arrayBuffer());
    const path = `/chunk-tamper/${basename(output.path)}`;
    artifacts.set(path, { body, type: "text/javascript" });
    graphIntegrity[`${assetOrigin}${path}`] = digest(body);
    if (output.kind === "chunk") alteredChunks.add(path);
    graphOutputs.push({
      path: relative(root, output.path),
      integrity: digest(body),
      kind: output.kind,
    });
  }
  documents.set(
    "/split-module",
    `<!doctype html><html><body><script type="module" src="${assetOrigin}/chunk-tamper/${basename(graphEntry.path)}" integrity="${digest(new Uint8Array(await graphEntry.arrayBuffer()))}" crossorigin="anonymous"></script></body></html>`,
  );
  const mapCases = ["map-original", "map-tamper", "map-missing-chunk-integrity"];
  const entryUrl = `${assetOrigin}/chunk-tamper/${basename(graphEntry.path)}`;
  const entryIntegrity = graphIntegrity[entryUrl];
  assert.ok(entryIntegrity, "Native entry integrity is required before browser controls.");
  for (const name of mapCases) {
    const nonce = crypto.randomUUID().replaceAll("-", "");
    const integrity =
      name === "map-missing-chunk-integrity" ? { [entryUrl]: entryIntegrity } : graphIntegrity;
    importMapNonces.set(`/${name}`, nonce);
    documents.set(
      `/${name}`,
      `<!doctype html><html><body><script type="importmap" nonce="${nonce}">${JSON.stringify({ integrity })}</script><script type="module" src="${entryUrl}" integrity="${entryIntegrity}" crossorigin="anonymous"></script></body></html>`,
    );
  }
  browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies([
    { name: "m1-fixture", value: "owned", url: appOrigin, httpOnly: true },
  ]);
  for (const name of [
    "native-plain",
    "native-source-integrity",
    ...cases,
    "split-module",
    ...mapCases,
  ]) {
    tamperChunks = name !== "map-original";
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    const requestsBefore = assetRequests.length;
    await page.goto(`${appOrigin}/${name}`, { waitUntil: "networkidle", timeout: 15000 });
    // Browser-only globals stay in the browser; do not add DOM ambient types to
    // the framework's server TypeScript project for a characterization fixture.
    const state = await page.evaluate<BrowserState>(`(() => ({
      executed: document.body.dataset.executed ?? null,
      api: document.body.dataset.api ?? null,
      chunk: document.body.dataset.chunk ?? null,
      color: getComputedStyle(document.body).color,
      images: [...document.images].map((image) => ({ width: image.naturalWidth, height: image.naturalHeight })),
      scripts: [...document.scripts].map((element) => ({ integrity: element.integrity, crossOrigin: element.crossOrigin })),
      styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map((element) => ({ integrity: element.integrity, crossOrigin: element.crossOrigin })),
    }))()`);
    const requests = assetRequests.slice(requestsBefore);
    observations.push({ name, state, errors, requests });
    if (name === "valid") {
      assert.equal(state.executed, "original");
      assert.equal(state.api, "application-origin");
      assert.equal(state.color, "rgb(12, 34, 56)");
    } else if (name === "script-tamper") {
      assert.equal(state.executed, null, "SRI must block altered script bytes.");
      assert.equal(state.color, "rgb(12, 34, 56)");
      assert.ok(errors.some((message) => /integrity|digest/i.test(message)));
    } else if (name === "style-tamper") {
      assert.equal(state.executed, "original");
      assert.equal(state.color, "rgb(0, 0, 0)", "SRI must block altered stylesheet bytes.");
      assert.ok(errors.some((message) => /integrity|digest/i.test(message)));
    } else if (name === "no-cors") {
      assert.equal(state.executed, null);
      assert.equal(state.color, "rgb(0, 0, 0)");
      assert.ok(errors.some((message) => /CORS/i.test(message)));
    } else if (name === "split-module") {
      assert.equal(
        state.executed,
        "original",
        "The integrity-protected entry bytes stay unchanged.",
      );
      assert.equal(state.api, "application-origin");
      assert.ok(requests.some((request) => alteredChunks.has(request.path)));
      // Record whether an altered dynamic import executes. An entry digest is
      // not presented as proof that the module graph has integrity protection.
    } else if (mapCases.includes(name)) {
      assert.equal(state.executed, "original", "The native entry stays unchanged.");
      assert.equal(state.api, "application-origin");
      assert.ok(requests.some((request) => alteredChunks.has(request.path)));
      if (name === "map-original") {
        assert.equal(state.chunk, "original", "Correct native bytes must execute with the map.");
      } else if (name === "map-tamper") {
        assert.equal(
          state.chunk,
          null,
          "Native import-map integrity must block the altered chunk.",
        );
        assert.ok(errors.some((message) => /integrity|digest/i.test(message)));
      }
      // Missing chunk metadata is observed, not described as graph protection.
    } else {
      // Record native behavior rather than making missing integrity a permanent
      // compatibility assertion that would reject a future upstream correction.
      assert.ok(requests.length >= 3, "Real native script/style/image requests required.");
      assert.deepEqual(state.images, [{ width: 7, height: 5 }]);
    }
    assert.ok(requests.length >= 2);
    assert.ok(requests.every((request) => !request.cookie && !request.authorization));
    await page.close();
  }
  assert.ok(apiRequests.length >= 2);
  assert.ok(
    apiRequests.every((request) => request.cookie),
    "Relative API requests stay on the cookie-bearing document origin.",
  );
  await writeFile(
    join(root, "receipt.json"),
    `${JSON.stringify(
      {
        status: "BOUNDED_BROWSER_CONTROLS_PASSED",
        bun: Bun.version,
        revision: Bun.revision,
        chromium: browser.version(),
        nativeBuilds,
        graphOutputs,
        importMapIntegrity: graphIntegrity,
        observations,
        apiRequests,
        scope:
          "Native SDK and Chromium loopback characterization only. No Strata API implementation, provider acceptance, production cookie policy, cached-client migration or lossless-transfer qualification.",
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
  console.log(
    `PASS ten browser cases; review native integrity observations in ${join(root, "receipt.json")}`,
  );
} catch (error) {
  await writeFile(
    join(root, "failure.json"),
    `${JSON.stringify(
      {
        status: "FAILED_OR_INCOMPLETE",
        bun: Bun.version,
        revision: Bun.revision,
        observations,
        apiRequests,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
  throw error;
} finally {
  try {
    await browser?.close();
  } finally {
    try {
      await app.stop(true);
    } finally {
      await assets.stop(true);
    }
  }
}
