/** Opt-in browser diagnostic; no framework API, bundle rewriting or browser patches.
 * Event expectations test link/script integrity behavior. The separate subsequent
 * import expectations retain the deliberately stronger persistent-rejection
 * hypothesis, not a claim that the HTML standard bans later unverified requests.
 * Mismatches remain red and are classified separately in the accompanying review.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type Browser, chromium, firefox, webkit } from "playwright";

type Case = {
  name: string;
  mode: "modulepreload" | "direct-module" | "classic-preload";
  altered?: boolean;
  mapFirst?: boolean;
  wrongDigest?: boolean;
  noIntegrity?: boolean;
  sameOrigin?: boolean;
  missing?: boolean;
  denyCors?: boolean;
  expectedEvent: string;
  expectedImport: string;
};

const cases: readonly [Case, ...Case[]] = [
  { name: "original", mode: "modulepreload", expectedEvent: "load", expectedImport: "original" },
  {
    name: "altered-no-map",
    mode: "modulepreload",
    altered: true,
    expectedEvent: "error",
    expectedImport: "rejected",
  },
  {
    name: "altered-map-first",
    mode: "modulepreload",
    altered: true,
    mapFirst: true,
    expectedEvent: "error",
    expectedImport: "rejected",
  },
  {
    name: "wrong-digest",
    mode: "modulepreload",
    wrongDigest: true,
    expectedEvent: "error",
    expectedImport: "rejected",
  },
  {
    name: "missing",
    mode: "modulepreload",
    missing: true,
    expectedEvent: "error",
    expectedImport: "rejected",
  },
  {
    name: "denied-cors",
    mode: "modulepreload",
    denyCors: true,
    expectedEvent: "error",
    expectedImport: "rejected",
  },
  {
    name: "altered-same-origin",
    mode: "modulepreload",
    altered: true,
    sameOrigin: true,
    expectedEvent: "error",
    expectedImport: "rejected",
  },
  {
    name: "altered-direct-module",
    mode: "direct-module",
    altered: true,
    expectedEvent: "error",
    expectedImport: "rejected",
  },
  {
    name: "altered-classic-preload",
    mode: "classic-preload",
    altered: true,
    expectedEvent: "error",
    expectedImport: "rejected",
  },
  {
    name: "altered-without-integrity",
    mode: "modulepreload",
    altered: true,
    noIntegrity: true,
    expectedEvent: "load",
    expectedImport: "altered",
  },
];

const output = process.argv[2];
assert.ok(output, "Supply a fresh owned output directory.");
const root = resolve(output);
await mkdir(root);
const engine = process.argv[3] ?? "chromium";
assert.match(engine, /^(chromium|firefox|webkit)$/);
const digest = (bytes: string | Buffer) =>
  `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
const requests: {
  path: string;
  status: number;
  cookie: boolean;
  authorization: boolean;
  integrity: string;
}[] = [];
const results: Record<string, unknown>[] = [];
let active: Case = cases[0];
let appOrigin = "";
let publicOrigin = "";
let app: ReturnType<typeof Bun.serve> | undefined;
let publicServer: ReturnType<typeof Bun.serve> | undefined;
let browser: Browser | undefined;

function source(value: string, classic = false) {
  return `globalThis.__m1preload=${JSON.stringify(value)};${classic ? "" : `export const value=${JSON.stringify(value)};`}`;
}
function moduleResponse(request: Request) {
  const body = source(active.altered ? "altered" : "original", active.mode === "classic-preload");
  const status = active.missing ? 404 : 200;
  requests.push({
    path: new URL(request.url).pathname,
    status,
    cookie: request.headers.has("cookie"),
    authorization: request.headers.has("authorization"),
    integrity: digest(body),
  });
  return new Response(active.missing ? "missing" : body, {
    status,
    headers: {
      "Content-Type": "text/javascript",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(active.denyCors ? {} : { "Access-Control-Allow-Origin": appOrigin }),
    },
  });
}

try {
  publicServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: moduleResponse });
  publicOrigin = `http://127.0.0.1:${publicServer.port}`;
  app = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/module.js") return moduleResponse(request);
      return new Response("<!doctype html><html><head></head><body></body></html>", {
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "no-store",
          "Content-Security-Policy": `default-src 'none'; script-src 'self' ${publicOrigin} 'nonce-m1-events'; base-uri 'none'`,
        },
      });
    },
  });
  appOrigin = `http://localhost:${app.port}`;
  browser = await (engine === "webkit"
    ? webkit
    : engine === "firefox"
      ? firefox
      : chromium
  ).launch();
  for (const item of cases) {
    active = item;
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (event) => {
      if (event.type() === "error") errors.push(event.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    const before = requests.length;
    const url = `${item.sameOrigin ? appOrigin : publicOrigin}/module.js`;
    const integrity = digest(
      source(item.wrongDigest ? "unserved" : "original", item.mode === "classic-preload"),
    );
    let observed: unknown;
    try {
      await page.goto(appOrigin);
      observed = await page.evaluate(
        `(async()=>{
          const spec=${JSON.stringify({ ...item, url, integrity })};
          if(spec.mapFirst){const map=document.createElement('script');map.type='importmap';map.nonce='m1-events';map.textContent=JSON.stringify({integrity:{[spec.url]:spec.integrity}});document.head.append(map);}
          let appliedIntegrity=null;
          const event=await new Promise(resolve=>{
            const node=document.createElement(spec.mode==='direct-module'?'script':'link');
            if(spec.mode==='direct-module'){node.type='module';node.src=spec.url;}else{node.rel=spec.mode==='classic-preload'?'preload':'modulepreload';node.href=spec.url;if(spec.mode==='classic-preload')node.as='script';}
            node.crossOrigin='anonymous';if(!spec.noIntegrity)node.integrity=spec.integrity;
            appliedIntegrity=node.getAttribute('integrity');
            const timer=setTimeout(()=>resolve('timeout'),5000);node.onload=()=>{clearTimeout(timer);resolve('load');};node.onerror=()=>{clearTimeout(timer);resolve('error');};document.head.append(node);
          });
          const beforeImport=globalThis.__m1preload??null;
          const imported=await new Promise(resolve=>{
            const script=document.createElement('script');script.nonce='m1-events';
            if(spec.mode==='classic-preload'){script.src=spec.url;script.crossOrigin='anonymous';script.integrity=spec.integrity;script.onload=()=>resolve(globalThis.__m1preload??'missing');script.onerror=()=>resolve('rejected');}
            else{script.type='module';script.textContent='import('+JSON.stringify(spec.url)+').then(m=>document.body.dataset.result=m.value).catch(()=>document.body.dataset.result="rejected")';}
            document.head.append(script);
            if(spec.mode!=='classic-preload'){const started=Date.now();const poll=()=>{if(document.body.dataset.result)resolve(document.body.dataset.result);else if(Date.now()-started>5000)resolve('timeout');else setTimeout(poll,10);};poll();}
          });
          return {event,appliedIntegrity,beforeImport,imported,afterImport:globalThis.__m1preload??null};
        })()`,
      );
      const actual = observed as {
        event: string;
        appliedIntegrity: string | null;
        imported: string;
        beforeImport: string | null;
        afterImport: string | null;
      };
      const failures: string[] = [];
      assert.equal(actual.appliedIntegrity, item.noIntegrity ? null : integrity);
      if (actual.event !== item.expectedEvent)
        failures.push(`event expected ${item.expectedEvent}, observed ${actual.event}`);
      if (actual.imported !== item.expectedImport)
        failures.push(`import expected ${item.expectedImport}, observed ${actual.imported}`);
      if (item.expectedImport === "rejected" && actual.afterImport !== null)
        failures.push(`unexpected executed marker ${actual.afterImport}`);
      assert.ok(requests.length > before, "No actual module request observed.");
      results.push({
        name: item.name,
        expected: { event: item.expectedEvent, imported: item.expectedImport },
        actual,
        failures,
        errors,
        requests: requests.slice(before),
        passed: failures.length === 0,
      });
      console.log(`${failures.length ? "FAIL" : "PASS"} ${item.name}: ${JSON.stringify(actual)}`);
    } catch (error) {
      results.push({
        name: item.name,
        passed: false,
        observed,
        errors,
        error: String(error),
        requests: requests.slice(before),
      });
    } finally {
      await context.close();
    }
  }
  const failed = results.filter((item) => !item.passed).length;
  await writeFile(
    join(root, "result.json"),
    JSON.stringify(
      {
        status: failed ? "CONTROL_MISMATCH_RECORDED" : "BOUNDED_CONTROLS_PASSED",
        sourceIntegrity: digest(await readFile(import.meta.path)),
        bun: Bun.version,
        revision: Bun.revision,
        engine,
        browserVersion: browser.version(),
        executed: results.length,
        expected: cases.length,
        failed,
        passed: results.length - failed,
        skipped: 0,
        existingGraphProbeChanged: false,
        subsequentImportExpectationsAreCandidateHypotheses: true,
        eventMismatches: results.filter((item) => {
          const actual = item.actual as { event?: string } | undefined;
          const expected = item.expected as { event?: string } | undefined;
          return actual?.event !== expected?.event;
        }).length,
        scope:
          "Native browser event/import isolation only; no Strata runtime, shipping-browser, TLS/provider or major API acceptance.",
        results,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  if (failed) process.exitCode = 1;
} catch (error) {
  await writeFile(
    join(root, "failure.json"),
    JSON.stringify(
      { engine, executed: results.length, expected: cases.length, error: String(error), results },
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
      await publicServer?.stop(true);
    }
  }
}
