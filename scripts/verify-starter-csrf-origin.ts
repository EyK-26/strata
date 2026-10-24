/** Real generated/installed app behind an owned HTTPS edge; no application adapter.
 * --published=VERSION qualifies exact registry packages. No mail or external database. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { chromium } from "playwright";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";

const publishedVersion = process.argv.find((value) => value.startsWith("--published="))?.slice(12);
const fixture = await createGeneratedSecurityApp(
  "sqlite",
  [
    "--frontend=server-htmx",
    "--auth=headers",
    "--tenancy=none",
    "--cache=array",
    "--queue=sync",
    "--mail=log",
    "--no-mfa",
    "--no-email-verification",
    "--no-scim",
    "--no-metrics",
    "--no-docker",
  ],
  { publishedVersion, parentDirectory: process.env.STARTER_JOURNEY_PARENT },
);
let child: Subprocess<"ignore", "pipe", "pipe"> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let childOutput: Promise<string> | undefined;
let childErrors: Promise<string> | undefined;
try {
  const module = join(fixture.app, "src/modules/proxy-form");
  await mkdir(module, { recursive: true });
  await writeFile(
    join(module, "index.ts"),
    `import type { AppModule } from '@getstrata/bootstrap/contracts';
import {resolveCsrfTokenForRequest} from '@getstrata/core/http/csrfToken';
const app: AppModule={name:'proxy-form',webRoutes({kernel}){
 const form=kernel.wrapWeb(async (request: Request & {params?:{id?:string}})=>{
  if(request.method==='GET')return new Response('<form method="post"><input name="_token" value="'+resolveCsrfTokenForRequest(request)+'"><input name="email" value="invalid"><button>Submit</button></form>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
  const body=await request.formData();return Response.json({email:body.get('email'),id:request.params?.id,protocol:new URL(request.url).protocol,origin:request.headers.get('origin')},{status:422});
 });return {'/proxy-form/:id':{GET:form,POST:form}};
}};export default app;
`,
  );
  const key = join(fixture.app, "fixture-key.pem");
  const cert = join(fixture.app, "fixture-cert.pem");
  const certificate = Bun.spawnSync(
    [
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      key,
      "-out",
      cert,
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1,DNS:forms.example.test",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  assert.equal(certificate.exitCode, 0, "Generate owned TLS certificate.");
  const ca = await readFile(cert, "utf8");
  const probe = join(fixture.app, "proxy-origin-probe.ts");
  await writeFile(
    probe,
    `import {bootstrapApp,createAppServer} from './src/bootstrap/createApp.ts';
import {closeDatabase} from './src/bootstrap/database.ts';
let server: ReturnType<typeof createAppServer>|undefined;let context: Awaited<ReturnType<typeof bootstrapApp>>['context']|undefined;
const edge=Bun.serve({hostname:'127.0.0.1',port:0,tls:{key:Bun.file('./fixture-key.pem'),cert:Bun.file('./fixture-cert.pem')},async fetch(request){
 if(!server)return new Response('starting',{status:503});
 const headers=new Headers(request.headers);headers.delete('content-length');headers.delete('forwarded');
 headers.set('x-forwarded-proto','https');headers.set('x-forwarded-host',headers.get('host')??'');headers.set('x-forwarded-for','127.0.0.1');
 let url:URL;try{url=new URL(request.url)}catch{return new Response('invalid authority',{status:400})}
 return fetch(new URL(url.pathname+url.search,server.url),{method:request.method,headers,...(request.method==='POST'?{body:await request.arrayBuffer()}:{}),redirect:'manual'});
}});
let closing:Promise<void>|undefined;
const close=()=>closing??=(async()=>{await edge.stop(true);await server?.stop(true);try{await context?.dispose()}finally{await closeDatabase()}})();
process.once('SIGTERM',()=>{void close().finally(()=>process.exit(0))});
process.on('message',message=>{if(message==='close')void close().then(()=>process.exit(0))});
try{
 const publicOrigin='https://forms.example.test:'+edge.port;
 process.env.APP_URL=publicOrigin;process.env.CSRF_TARGET_ORIGIN=process.env.INVALID_CSRF_TARGET??publicOrigin;
 const app=await bootstrapApp({migrate:false});context=app.context;
 server=createAppServer(app.routes,0,undefined,{hostname:'127.0.0.1'});
 process.send?.({edge:edge.url.origin,backend:server.url.origin,publicOrigin});
}catch(error){await close();throw error}
`,
  );
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    APP_ENV: "production",
    APP_DEBUG: "false",
    DATABASE_URL: fixture.runtimeUrl,
    DB_CONNECTION: "sqlite",
    SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID(),
    AUTH_DEV_HEADERS: "false",
    TENANT_DEV_HEADERS: "false",
    TENANCY_DRIVER: "none",
    FRONTEND_MODE: "server-htmx",
    CACHE_DRIVER: "array",
    QUEUE_DRIVER: "sync",
    MAIL_DRIVER: "log",
    REDIS_URL: "",
    FEATURE_API_TOKENS: "false",
    FEATURE_MFA: "false",
    FEATURE_EMAIL_VERIFICATION: "false",
    FEATURE_SCIM: "false",
    FEATURE_METRICS: "false",
    FEATURE_OAUTH: "false",
    FEATURE_SAML: "false",
    OTEL_SDK_DISABLED: "true",
    APP_KEY_PREFIX: "proxy-consumer",
  };
  const typecheck = Bun.spawnSync([process.execPath, "run", "check"], {
    cwd: fixture.app,
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60000,
  });
  assert.equal(
    typecheck.exitCode,
    0,
    `Generated app typecheck: ${typecheck.stdout.toString()}${typecheck.stderr.toString()}`,
  );
  type Ready = { edge: string; backend: string; publicOrigin: string };
  let notifyReady: (value: Ready) => void = () => {};
  const ready = new Promise<Ready>((resolve) => {
    notifyReady = resolve;
  });
  child = Bun.spawn([process.execPath, probe], {
    cwd: fixture.app,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    ipc(message) {
      if (message && typeof message === "object" && "edge" in message && "publicOrigin" in message)
        notifyReady(message as Ready);
    },
  });
  childOutput = new Response(child.stdout).text();
  childErrors = new Response(child.stderr).text();
  const timeout = setTimeout(() => child?.kill("SIGTERM"), 30000);
  let endpoints: Ready;
  try {
    endpoints = await Promise.race([
      ready,
      child.exited.then(async () => {
        throw new Error(`Generated probe exited before ready: ${await childErrors}`);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  const host = new URL(endpoints.publicOrigin).host;
  const formPath = "/proxy-form/na%C3%AFve";
  const get = await fetch(endpoints.edge + formPath, { tls: { ca }, headers: { Host: host } });
  assert.equal(get.status, 200);
  const html = await get.text();
  const token = html.match(/name="_token" value="([^"]+)"/)?.[1];
  assert.ok(token);
  const setCookie = get.headers.getSetCookie();
  assert.equal(setCookie.length, 1);
  assert.match(setCookie[0] ?? "", /; Secure/);
  const cookie = setCookie.map((value) => value.split(";")[0]).join("; ");
  const post = (
    origin: string | null,
    submitted: string | null,
    override: Record<string, string> = {},
  ) => {
    const headers = new Headers({ Host: host, Cookie: cookie, ...override });
    if (origin !== null) headers.set("Origin", origin);
    return fetch(endpoints.edge + formPath, {
      method: "POST",
      tls: { ca },
      headers,
      body: new URLSearchParams({
        email: "invalid",
        ...(submitted !== null ? { _token: submitted } : {}),
      }),
    });
  };
  const submitted = await post(endpoints.publicOrigin, token);
  assert.equal(submitted.status, 422);
  assert.deepEqual(await submitted.json(), {
    email: "invalid",
    id: "naïve",
    protocol: "http:",
    origin: endpoints.publicOrigin,
  });
  for (const [origin, submittedToken] of [
    [endpoints.publicOrigin, null],
    [endpoints.publicOrigin, "invalid"],
    ["https://evil.example.test", token],
    [null, token],
    ["null", token],
    [`${endpoints.publicOrigin}/path`, token],
  ] as const)
    assert.equal((await post(origin, submittedToken)).status, 403);
  const unknown = await fetch(endpoints.edge + formPath, {
    tls: { ca },
    headers: { Host: "evil.example.test" },
  });
  assert.equal(unknown.status, 403);
  assert.equal(unknown.headers.getSetCookie().length, 0);
  const direct = await fetch(endpoints.backend + formPath, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: endpoints.publicOrigin,
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Host": host,
    },
    body: new URLSearchParams({ _token: token, email: "invalid" }),
  });
  assert.equal(direct.status, 403);

  // Comma authorities have a parseable URL and fail the explicit Host policy.
  // Bun exposes a relative URL for userinfo-style wire Host; native admission must reject it.
  const malformedWireStatuses: number[] = [];
  for (const host of ["forms.example.test,evil.example.test", "user@forms.example.test"]) {
    const rejected = await fetch(endpoints.backend + formPath, { headers: { Host: host } });
    malformedWireStatuses.push(rejected.status);
    assert.equal(rejected.headers.getSetCookie().length, 0);
  }
  assert.deepEqual(malformedWireStatuses, [403, 400]);

  browser = await chromium.launch({
    headless: true,
    args: ["--host-resolver-rules=MAP forms.example.test 127.0.0.1", "--no-proxy-server"],
  });
  const browserContext = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const page = await browserContext.newPage();
    assert.equal((await page.goto(endpoints.publicOrigin + formPath))?.status(), 200);
    const cookies = await browserContext.cookies(endpoints.publicOrigin);
    assert.equal(cookies.length, 1);
    assert.equal(cookies[0]?.secure, true);
    assert.equal(cookies[0]?.httpOnly, true);
    const [response] = await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST"),
      page.getByRole("button", { name: "Submit" }).click(),
    ]);
    assert.equal(response.status(), 422);
    assert.equal((await response.json()).protocol, "http:");
  } finally {
    await browserContext.close();
  }
  await browser.close();
  browser = undefined;
  child.send("close");
  assert.equal(await child.exited, 0);
  await childOutput;
  await childErrors;
  child = undefined;
  const invalid = Bun.spawn([process.execPath, probe], {
    cwd: fixture.app,
    env: { ...env, INVALID_CSRF_TARGET: "https://forms.example.test/path" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [invalidOut, invalidError, invalidCode] = await Promise.all([
    new Response(invalid.stdout).text(),
    new Response(invalid.stderr).text(),
    invalid.exited,
  ]);
  assert.notEqual(invalidCode, 0);
  assert.match(invalidOut + invalidError, /CSRF targetOrigin must be/);
  console.log(
    JSON.stringify({
      version: publishedVersion ?? "candidate-packages",
      generatedProvider: true,
      adapter: false,
      browser: 422,
      validForm: 422,
      securityControls: true,
      nativeParams: true,
      invalidStartupRefused: true,
      malformedHostControls: true,
    }),
  );
} finally {
  await browser?.close();
  if (child) {
    child.kill("SIGTERM");
    await child.exited;
    await childOutput;
    await childErrors;
  }
  await fixture.close();
}
