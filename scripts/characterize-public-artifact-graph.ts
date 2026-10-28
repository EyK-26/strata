/** Opt-in native SDK/browser feasibility only. No framework route, resolver or
 * delivery implementation. Original native outputs are immutable; only fixture
 * response bytes are changed for negative controls. Run sequentially. Browser
 * differences remain failed controls; --continue-on-failure gathers them without
 * changing any expectation or returning success. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, firefox, type Page, webkit } from "playwright";

type Case = {
  name: string;
  mode: string;
  tamper: string;
  control: boolean;
  entry?: string | null;
  omitShared?: boolean;
  preloadIntegrity?: boolean;
};
type Artifact = {
  path: string;
  file: string;
  body: Uint8Array;
  mediaType: string;
  integrity: string;
  kind: string;
  inputs: string[] | null;
  imports: unknown[] | null;
  metafilePresent: boolean;
};
type Graph = {
  label: string;
  artifacts: Artifact[];
  entry: Artifact;
  second: Artifact;
  shared: Artifact;
  lazy: Artifact;
  worker: Artifact;
  workerChild: Artifact;
  css: Artifact;
  externalCss: Artifact;
  image: Artifact;
  font: Artifact;
  metafiles: unknown[];
};
type RequestRecord = {
  owner: string;
  path: string;
  cookie: boolean;
  authorization: boolean;
  status: number;
  originalIntegrity?: string;
  wireIntegrity?: string;
  tampered?: boolean;
};
type State = {
  entry: string | null;
  shared: string | null;
  second: string | null;
  lazy: string | null;
  color: string;
  background: string;
  font: string;
  nestedStyle: string;
  image: { width: number; height: number } | null;
  sharedEvaluations: number;
};
const output = process.argv[2];
assert.ok(output, "Pass a fresh owned receipt directory.");
const browserName = process.argv.find((x) => x.startsWith("--browser="))?.slice(10) ?? "chromium";
assert.match(browserName, /^(chromium|firefox|webkit)$/);
const continueOnFailure = process.argv.includes("--continue-on-failure");
const failures: { name: string; error: string }[] = [];
const root = resolve(output);
await mkdir(root);
const fixtureRoot = join(import.meta.dir, "fixtures/m1-artifact-graph");
const casesFile =
  process.argv.find((x) => x.startsWith("--cases="))?.slice(8) ?? join(fixtureRoot, "cases.json");
const cases = JSON.parse(await readFile(casesFile, "utf8")) as Case[];
assert.equal(cases.length, 17);
assert.equal(new Set(cases.map((x) => x.name)).size, 17);
const digest = (bytes: Uint8Array) =>
  `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
const inputs = {
  source: digest(await readFile(import.meta.path)),
  cases: digest(await readFile(casesFile)),
  fixtures: Object.fromEntries(
    await Promise.all(
      (await readdir(fixtureRoot))
        .filter((name) => name !== "cases.json")
        .sort()
        .map(async (name) => [name, digest(await readFile(join(fixtureRoot, name)))]),
    ),
  ),
};
const artifacts = new Map<string, Artifact>();
const requests: RequestRecord[] = [];
const observations: Record<string, unknown>[] = [];
const unavailable = new Set<string>();
let currentCase: Case | undefined;
let currentBuild = "A";
let browser: Browser | undefined;
let app: ReturnType<typeof Bun.serve> | undefined;
let appOrigin = "";
let graphs: Record<string, Graph> = {};
let nativeOutputsUnchanged: boolean | null = null;
function wire(artifact: Artifact): Uint8Array {
  const graph = graphs.A;
  if (!graph) return artifact.body;
  const mode = currentCase?.tamper;
  if (mode === "shared" && artifact === graph.shared)
    return Buffer.from(
      new TextDecoder().decode(artifact.body).replace("shared-original", "shared-tampered"),
    );
  if (mode === "lazy" && artifact === graph.lazy)
    return Buffer.from(
      new TextDecoder().decode(artifact.body).replace("lazy-original-", "lazy-tampered-"),
    );
  if (mode === "worker-child" && artifact === graph.workerChild)
    return Buffer.from(
      new TextDecoder()
        .decode(artifact.body)
        .replace("worker-child-original", "worker-child-tampered"),
    );
  if (mode === "worker" && artifact === graph.worker)
    return Buffer.from(
      new TextDecoder().decode(artifact.body) + '\nself.postMessage("worker-entry-tampered");',
    );
  if (mode === "css" && artifact === graph.css)
    return Buffer.from(new TextDecoder().decode(artifact.body) + "\nbody{color:rgb(98,76,54)}");
  if (mode === "image" && artifact === graph.image)
    return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="9" height="6"></svg>');
  if (mode === "font" && artifact === graph.font)
    return Buffer.concat([artifact.body, Buffer.alloc(16)]);
  return artifact.body;
}
function assetResponse(request: Request, artifact: Artifact, owner: string) {
  const path = new URL(request.url).pathname;
  const missing = unavailable.has(path);
  const body = wire(artifact);
  requests.push({
    owner,
    path,
    cookie: request.headers.has("cookie"),
    authorization: request.headers.has("authorization"),
    status: missing ? 404 : 200,
    originalIntegrity: artifact.integrity,
    wireIntegrity: digest(body),
    tampered: digest(body) !== artifact.integrity,
  });
  return new Response(missing ? "missing" : body, {
    status: missing ? 404 : 200,
    headers: {
      "Content-Type": missing ? "text/plain" : artifact.mediaType,
      "Access-Control-Allow-Origin": appOrigin,
      "Cache-Control": "public,max-age=31536000,immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
const publicServer = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    const artifact = artifacts.get(path);
    if (artifact) return assetResponse(request, artifact, "public");
    requests.push({
      owner: "public",
      path,
      cookie: request.headers.has("cookie"),
      authorization: request.headers.has("authorization"),
      status: 404,
    });
    return new Response("missing", { status: 404 });
  },
});
const publicOrigin = `http://127.0.0.1:${publicServer.port}`;
function integrityMap(graph: Graph) {
  const entries = graph.artifacts
    .filter((a) => a.mediaType.includes("javascript"))
    .map((a) => [publicOrigin + a.path, a.integrity]);
  entries.push([
    appOrigin + "/guarded-worker/" + basename(graph.worker.path),
    graph.worker.integrity,
  ]);
  if (currentCase?.omitShared)
    return Object.fromEntries(entries.filter(([url]) => url !== publicOrigin + graph.shared.path));
  return Object.fromEntries(entries);
}
function document(graph: Graph) {
  const nonce = "m1-graph-fixture";
  const map = `<script type="importmap" nonce="${nonce}">${JSON.stringify({ integrity: integrityMap(graph) })}</script>`;
  const css = currentCase?.mode === "css-external" ? graph.externalCss : graph.css;
  const style = currentCase?.mode.startsWith("css-")
    ? `<link rel="stylesheet" href="${publicOrigin + css.path}" integrity="${css.integrity}" crossorigin="anonymous">`
    : "";
  const image =
    currentCase?.mode === "css-external"
      ? `<img id="mark" src="${publicOrigin + graph.image.path}">`
      : "";
  const entry = `<script type="module" src="${publicOrigin + graph.entry.path}" integrity="${graph.entry.integrity}" crossorigin="anonymous"></script>`;
  const second = `<script type="module" src="${publicOrigin + graph.second.path}" integrity="${graph.second.integrity}" crossorigin="anonymous"></script>`;
  return `<!doctype html><html><head>${currentCase?.mode === "preload" ? "" : map}${style}</head><body><button id="load">load</button>${image}${currentCase?.mode === "window" || currentCase?.mode === "cached" || currentCase?.mode === "missing-old" ? entry + second : ""}</body></html>`;
}
async function buildGraph(label: string): Promise<Graph> {
  const input = join(root, label, "input");
  await mkdir(input, { recursive: true });
  for (const name of await readdir(fixtureRoot))
    if (name.endsWith(".js") || name.endsWith(".css") || name.endsWith(".svg"))
      await copyFile(join(fixtureRoot, name), join(input, name));
  const playwright = dirname(fileURLToPath(import.meta.resolve("playwright")));
  const fontRoot = resolve(playwright, "../playwright-core/lib/vite/recorder/assets");
  const fontName = (await readdir(fontRoot)).find((name) => /^codicon.*\.ttf$/.test(name));
  assert.ok(fontName, "Installed Playwright's own fixture font required.");
  await copyFile(join(fontRoot, fontName), join(input, "fixture.ttf"));
  await writeFile(join(input, "build.js"), `export const build=${JSON.stringify(label)};`);
  const prefix = `/releases/${label}/`;
  const built: Artifact[] = [];
  const metafiles: unknown[] = [];
  async function build(names: string[], directory: string) {
    const result = await Bun.build({
      entrypoints: names.map((n) => join(input, n)),
      outdir: join(root, label, directory),
      target: "browser",
      splitting: true,
      publicPath: publicOrigin + prefix,
      loader: { ".ttf": "file", ".svg": "file" },
      naming: {
        entry: "[name]-[hash].[ext]",
        chunk: "chunk-[hash].[ext]",
        asset: "[name]-[hash].[ext]",
      },
      metafile: true,
    });
    assert.ok(result.success, result.logs.map(String).join("\n"));
    assert.ok(result.metafile);
    metafiles.push(result.metafile);
    for (const output of result.outputs) {
      const body = new Uint8Array(await output.arrayBuffer());
      const metadata: { inputs: Record<string, unknown>; imports: unknown[] } | undefined =
        result.metafile.outputs["./" + basename(output.path)];
      assert.ok(metadata || output.kind === "asset", `Module metadata required: ${output.path}`);
      const artifact: Artifact = {
        path: prefix + basename(output.path),
        file: output.path,
        body,
        mediaType: output.type.split(";")[0] ?? "application/octet-stream",
        integrity: digest(body),
        kind: output.kind,
        inputs: metadata ? Object.keys(metadata.inputs) : null,
        imports: metadata?.imports ?? null,
        metafilePresent: metadata !== undefined,
      };
      const previous = artifacts.get(artifact.path);
      if (previous)
        assert.equal(
          previous.integrity,
          artifact.integrity,
          "Immutable output destination collision.",
        );
      artifacts.set(artifact.path, artifact);
      built.push(artifact);
    }
  }
  await build(["entry.js", "second.js", "worker.js", "style.css"], "graph");
  await build(["assets.js"], "selected-assets");
  function fromInput(name: string) {
    const found = built.find((a) => a.inputs?.some((p) => p.endsWith("/" + name)));
    assert.ok(found, `Native output for ${name}`);
    return found;
  }
  const font = built.find((a) => a.mediaType === "font/ttf");
  const image = built.find((a) => a.mediaType === "image/svg+xml");
  assert.ok(font);
  assert.ok(image);
  const external = (await readFile(join(input, "external-style.css"), "utf8"))
    .replace("__FONT_URL__", publicOrigin + font.path)
    .replace("__IMAGE_URL__", publicOrigin + image.path);
  await writeFile(join(input, "external-style.css"), external);
  await build(["external-style.css"], "external-css");
  const css = built.find(
    (a) => a.file.endsWith(".css") && !basename(a.file).startsWith("external-style-"),
  );
  const externalCss = built.find((a) => basename(a.file).startsWith("external-style-"));
  assert.ok(css);
  assert.ok(externalCss);
  assert.ok(new TextDecoder().decode(css.body).includes("data:font/ttf"));
  assert.ok(new TextDecoder().decode(css.body).includes("data:image/svg+xml"));
  const graph = {
    label,
    artifacts: built,
    entry: fromInput("entry.js"),
    second: fromInput("second.js"),
    shared: fromInput("shared.js"),
    lazy: fromInput("lazy.js"),
    worker: fromInput("worker.js"),
    workerChild: fromInput("worker-child.js"),
    css,
    externalCss,
    image,
    font,
    metafiles,
  };
  await writeFile(
    join(root, label, "build-receipt.json"),
    JSON.stringify(
      {
        label,
        artifacts: built.map(({ body, ...a }) => ({ ...a, bytes: body.length })),
        metafiles,
      },
      null,
      2,
    ) + "\n",
  );
  return graph;
}
async function state(page: Page): Promise<State> {
  return page.evaluate<State>(
    `(async()=>{let font="not-requested";try{if(document.querySelector('link[rel=stylesheet]'))font=(await document.fonts.load('16px M1Fixture')).map(x=>x.status).join(',');}catch{font='rejected';}const image=document.querySelector('#mark');return {entry:document.body.dataset.entry??null,shared:document.body.dataset.shared??null,second:document.body.dataset.second??null,lazy:document.body.dataset.lazy??null,color:getComputedStyle(document.body).color,background:getComputedStyle(document.body).backgroundImage,font,nestedStyle:getComputedStyle(document.body).getPropertyValue('--nested-style').trim(),image:image?{width:image.naturalWidth,height:image.naturalHeight}:null,sharedEvaluations:globalThis.__sharedEvaluations??0};})()`,
  );
}
// Poll through the native locator API: string predicates would invoke page eval and
// require unsafe-eval, which this fixture deliberately never grants.
async function waitForData(page: Page, key: string, expected?: string) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const value = await page.locator("body").getAttribute(`data-${key}`);
    if (expected === undefined ? value !== null : value === expected) return;
    await Bun.sleep(25);
  }
  assert.fail(`Browser data-${key} did not reach ${expected ?? "a value"}.`);
}
async function loadLazy(page: Page) {
  await page.click("#load");
  await waitForData(page, "lazy");
}
async function worker(page: Page, url: string) {
  return page.evaluate<{ value: string; error?: string }>(
    `new Promise(resolve=>{let worker;const timer=setTimeout(()=>{worker?.terminate();resolve({value:'timeout'});},8000);try{worker=new Worker(${JSON.stringify(url)},{type:'module'});worker.onmessage=e=>{clearTimeout(timer);worker.terminate();resolve({value:e.data});};worker.onerror=e=>{clearTimeout(timer);worker.terminate();resolve({value:'rejected',error:e.message});};worker.postMessage('load');}catch(error){clearTimeout(timer);resolve({value:'constructor-rejected',error:String(error)});}})`,
  );
}
try {
  app = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      const authorized = request.headers.get("cookie")?.includes("m1-graph=owned") ?? false;
      if (path.startsWith("/guarded-worker/")) {
        const artifact = Object.values(graphs).find((g) =>
          path.endsWith("/" + basename(g.worker.path)),
        )?.worker;
        if (!authorized || !artifact) return new Response("denied", { status: 403 });
        return assetResponse(request, artifact, "guarded-worker");
      }
      if (!authorized) return new Response("denied", { status: 403 });
      const graph = graphs[currentBuild];
      if (!graph) return new Response("not-ready", { status: 503 });
      return new Response(document(graph), {
        headers: {
          "Content-Type": "text/html;charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": `default-src 'none'; script-src 'self' ${publicOrigin} 'nonce-m1-graph-fixture'; style-src ${publicOrigin}; img-src ${publicOrigin} data:; font-src ${publicOrigin} data:; worker-src 'self' ${publicOrigin}; connect-src 'self'; base-uri 'none'`,
        },
      });
    },
  });
  appOrigin = `http://localhost:${app.port}`;
  const graphA = await buildGraph("A");
  const graphB = await buildGraph("B");
  graphs = { A: graphA, B: graphB };
  browser = await (browserName === "firefox"
    ? firefox
    : browserName === "webkit"
      ? webkit
      : chromium
  ).launch();
  assert.equal(
    (await fetch(appOrigin)).status,
    403,
    "Fixture application remains denied without its cookie.",
  );
  for (const item of cases) {
    currentCase = item;
    currentBuild = "A";
    unavailable.clear();
    const context = await browser.newContext();
    await context.addCookies([
      { name: "m1-graph", value: "owned", url: appOrigin, httpOnly: true },
    ]);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    const before = requests.length;
    let detail: unknown;
    try {
      await page.goto(appOrigin, { waitUntil: "networkidle", timeout: 15000 });
      if (item.mode === "window") {
        if (item.tamper === "lazy" || item.tamper === "none") {
          await waitForData(page, "entry");
          await loadLazy(page);
        }
        const actual = await state(page);
        detail = actual;
        if (Object.hasOwn(item, "entry")) assert.equal(actual.entry, item.entry);
        if (item.name === "window-full-map-original") {
          assert.equal(actual.shared, "shared-original");
          assert.equal(actual.second, "shared-original");
          assert.equal(actual.lazy, "lazy-original-A");
          assert.equal(actual.sharedEvaluations, 1);
        }
        if (item.name === "window-lazy-chunk-tamper") assert.equal(actual.lazy, "rejected");
        if (item.control && item.tamper !== "none")
          assert.ok(
            errors.some((e) => /integrity|digest/i.test(e)),
            errors.join("\n"),
          );
      } else if (item.mode === "preload") {
        // A fresh document has no module request yet. Native preload completes before the map is appended.
        const preload = await page.evaluate<string>(
          `new Promise(resolve=>{const link=document.createElement('link');link.rel='modulepreload';link.href=${JSON.stringify(publicOrigin + graphA.lazy.path)};link.crossOrigin='anonymous';${item.preloadIntegrity ? `link.integrity=${JSON.stringify(graphA.lazy.integrity)};` : ""}link.onload=()=>resolve('loaded');link.onerror=()=>resolve('rejected');document.head.append(link);})`,
        );
        await page.evaluate(
          `(()=>{const map=document.createElement('script');map.type='importmap';map.nonce='m1-graph-fixture';map.textContent=${JSON.stringify(JSON.stringify({ integrity: integrityMap(graphA) }))};document.head.append(map);const entry=document.createElement('script');entry.type='module';entry.src=${JSON.stringify(publicOrigin + graphA.entry.path)};entry.integrity=${JSON.stringify(graphA.entry.integrity)};entry.crossOrigin='anonymous';document.head.append(entry);})()`,
        );
        await waitForData(page, "entry");
        await loadLazy(page);
        const actual = await state(page);
        detail = { preload, state: actual };
        if (item.preloadIntegrity) {
          assert.equal(preload, "rejected");
          assert.equal(actual.lazy, "rejected");
        }
      } else if (item.mode.startsWith("worker-")) {
        const url =
          item.mode === "worker-public"
            ? publicOrigin + graphA.worker.path
            : appOrigin + "/guarded-worker/" + basename(graphA.worker.path);
        const actual = await worker(page, url);
        if (item.control) assert.equal(actual.value, "worker-child-original");
        detail = actual;
      } else if (item.mode.startsWith("css-")) {
        const actual = await state(page);
        if (item.control) {
          if (item.tamper === "css") {
            assert.equal(actual.color, "rgb(0, 0, 0)");
            assert.ok(errors.some((e) => /integrity|digest/i.test(e)));
          } else {
            assert.equal(actual.color, "rgb(12, 34, 56)");
            assert.equal(actual.nestedStyle, "nested-original");
            assert.equal(actual.font, "loaded");
            if (item.mode === "css-external")
              assert.deepEqual(actual.image, { width: 7, height: 5 });
            else assert.ok(actual.background.includes("data:image/svg+xml"));
          }
        }
        detail = actual;
      } else {
        const oldPage = page;
        await waitForData(oldPage, "entry", "A");
        const lazy = graphA.lazy.path;
        assert.ok(!requests.slice(before).some((r) => r.path === lazy));
        currentBuild = "B";
        const next = await context.newPage();
        await next.goto(appOrigin, { waitUntil: "networkidle" });
        await waitForData(next, "entry", "B");
        if (item.mode === "missing-old") unavailable.add(lazy);
        await loadLazy(oldPage);
        const oldState = await state(oldPage);
        assert.equal(oldState.lazy, item.mode === "missing-old" ? "rejected" : "lazy-original-A");
        if (item.mode === "missing-old")
          assert.ok(requests.slice(before).some((r) => r.path === lazy && r.status === 404));
        currentBuild = "A";
        const rolledBack = await context.newPage();
        await rolledBack.goto(appOrigin, { waitUntil: "networkidle" });
        await waitForData(rolledBack, "entry", "A");
        await loadLazy(next);
        assert.equal((await state(next)).lazy, "lazy-original-B");
        detail = {
          oldClient: oldState,
          newClient: await state(next),
          rolledBackEntry: (await state(rolledBack)).entry,
          retainedBuilds: ["A", "B"],
        };
      }
      const seen = requests.slice(before);
      assert.ok(
        seen.filter((r) => r.owner === "public").every((r) => !r.cookie && !r.authorization),
      );
      if (item.tamper !== "none" && item.mode !== "worker-public")
        assert.ok(
          seen.some((r) => r.tampered),
          "Negative wire bytes were not actually requested.",
        );
      if (item.mode === "worker-app")
        assert.ok(seen.some((r) => r.owner === "guarded-worker" && r.cookie));
      observations.push({
        name: item.name,
        classification: item.control ? "control" : "observation",
        status: "passed",
        detail,
        requests: seen,
        errors,
      });
      console.log(`PASS ${observations.length}/${cases.length} ${item.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ name: item.name, error: message });
      observations.push({
        name: item.name,
        classification: item.control ? "control" : "observation",
        status: "failed",
        detail,
        requests: requests.slice(before),
        errors,
        failure: message,
      });
      console.error(`FAIL ${observations.length}/${cases.length} ${item.name}: ${message}`);
      if (!continueOnFailure) throw error;
    } finally {
      await context.close();
    }
  }
  for (const artifact of artifacts.values())
    assert.equal(
      digest(await readFile(artifact.file)),
      artifact.integrity,
      "Native output files must remain unchanged.",
    );
  nativeOutputsUnchanged = true;
  if (failures.length)
    throw new AggregateError(
      failures.map((item) => new Error(`${item.name}: ${item.error}`)),
      "Browser contract controls did not all pass.",
    );
  await writeFile(
    join(root, "receipt.json"),
    JSON.stringify(
      {
        status: "BOUNDED_GRAPH_CONTROLS_PASSED",
        bun: Bun.version,
        revision: Bun.revision,
        browserEngine: browserName,
        browserVersion: browser.version(),
        inputs,
        expected: cases.length,
        executed: observations.length,
        controls: cases.filter((c) => c.control).length,
        observationsOnly: cases.filter((c) => !c.control).length,
        failed: 0,
        skipped: 0,
        observations,
        requests,
        nativeOutputsUnchanged,
        scope:
          "Selected pinned browser-engine/native Bun graph feasibility only; no public Strata API, provider/CDN/TLS/cookie-domain policy, all-browser, whole-arbitrary-graph or major migration acceptance.",
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
} catch (error) {
  await writeFile(
    join(root, "failure.json"),
    JSON.stringify(
      {
        status: "FAILED_OR_INCOMPLETE",
        bun: Bun.version,
        revision: Bun.revision,
        activeCase: currentCase?.name,
        browserEngine: browserName,
        browserVersion: browser?.version(),
        inputs,
        expected: cases.length,
        executed: observations.length,
        failedControls: failures,
        skipped: 0,
        observations,
        requests,
        nativeOutputsUnchanged,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  throw error;
} finally {
  try {
    await browser?.close();
  } finally {
    try {
      await app?.stop(true);
    } finally {
      await publicServer.stop(true);
    }
  }
}
