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
type ProbeOutcome = { code: number; stdout: string; stderr: string };
type ProbeChild = {
  process: Subprocess<"ignore", "pipe", "pipe">;
  settled: Promise<PromiseSettledResult<number | string>[]>;
  joined: boolean;
};
const children: ProbeChild[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let browserContext: Awaited<ReturnType<NonNullable<typeof browser>["newContext"]>> | undefined;
const failures: unknown[] = [];
let result: Record<string, unknown> | undefined;
const termination = new AbortController();
const interrupted = new Error("CSRF browser qualification interrupted by SIGTERM");
const terminate = () => {
  termination.abort(interrupted);
  process.exitCode = 143;
};
process.once("SIGTERM", terminate);
function throwFailures(errors: unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}
function observeChild(process: ProbeChild["process"]): ProbeChild {
  // Observe all streams immediately, including synchronous read failures, and
  // never finish observation before the actual process has exited.
  const owner: ProbeChild = {
    process,
    joined: false,
    settled: Promise.allSettled([
      process.exited,
      Promise.resolve().then(() => new Response(process.stdout).text()),
      Promise.resolve().then(() => new Response(process.stderr).text()),
    ]),
  };
  children.push(owner);
  return owner;
}
async function joinChild(
  owner: ProbeChild,
  close: "ipc" | "terminate" | "exit",
): Promise<ProbeOutcome> {
  const errors: unknown[] = [];
  const timeout = new Error("Generated probe did not settle within its bounded shutdown window.");
  let expired = false;
  const soft = setTimeout(() => {
    expired = true;
    try {
      owner.process.kill("SIGTERM");
    } catch (error) {
      errors.push(error);
    }
  }, 30000);
  const hard = setTimeout(() => {
    try {
      owner.process.kill("SIGKILL");
    } catch (error) {
      errors.push(error);
    }
  }, 35000);
  let settled: Awaited<ProbeChild["settled"]>;
  try {
    if (owner.process.exitCode === null) {
      try {
        if (close === "ipc") owner.process.send("close");
        else if (close === "terminate") owner.process.kill("SIGTERM");
      } catch (error) {
        errors.push(error);
        try {
          owner.process.kill("SIGTERM");
        } catch (killError) {
          errors.push(killError);
        }
      }
    }
    settled = await owner.settled;
    owner.joined = true;
  } finally {
    clearTimeout(soft);
    clearTimeout(hard);
  }
  if (expired) errors.push(timeout);
  errors.push(...settled.flatMap((item) => (item.status === "rejected" ? [item.reason] : [])));
  throwFailures(errors, "Generated probe process/streams/shutdown failed.");
  const [code, stdout, stderr] = settled.map((item) => {
    assert.equal(item.status, "fulfilled");
    return item.value;
  });
  assert.ok(typeof code === "number");
  assert.ok(typeof stdout === "string");
  assert.ok(typeof stderr === "string");
  return { code, stdout, stderr };
}
async function ownedFetch(
  input: Parameters<typeof fetch>[0],
  init: RequestInit & { tls?: { ca: string } } = {},
) {
  termination.signal.throwIfAborted();
  return fetch(input, {
    ...init,
    signal: AbortSignal.any([termination.signal, init.signal ?? AbortSignal.timeout(10000)]),
  });
}

try {
  const module = join(fixture.app, "src/modules/proxy-form");
  await mkdir(module, { recursive: true });
  await writeFile(
    join(module, "index.ts"),
    `import type { AppModule } from '@getstrata/bootstrap/contracts';
import {resolveCsrfTokenForRequest} from '@getstrata/core/http/csrfToken';
import {STARTER_AUTH_SERVICES} from '../../bootstrap/providers/auth.ts';
const app: AppModule={name:'proxy-form',webRoutes({kernel,dependencies}){
 const csrf=dependencies.container.resolve(STARTER_AUTH_SERVICES).csrf;
 const form=kernel.wrapWeb(async (request: Request & {params?:{id?:string}})=>{
  if(request.method==='GET')return new Response('<form method="post"><input name="_token" value="'+resolveCsrfTokenForRequest(request,csrf)+'"><input name="email" value="invalid"><button>Submit</button></form>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
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
      "subjectAltName=IP:127.0.0.1,DNS:forms.localhost",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  assert.equal(certificate.exitCode, 0, "Generate owned TLS certificate.");
  const ca = await readFile(cert, "utf8");
  const probe = join(fixture.app, "proxy-origin-probe.ts");
  await writeFile(
    probe,
    `import assert from 'node:assert/strict';
import {bootstrapApp} from './src/bootstrap/createApp.ts';
let server: Awaited<ReturnType<typeof bootstrapApp>>['server'];
let application: Awaited<ReturnType<typeof bootstrapApp>>['application']|undefined;
let edge: ReturnType<typeof Bun.serve>|undefined;
const failures: unknown[]=[];
let primaryCount=0;
let requested=false, signalled=false, admitted=false;
let notifyClose:()=>void=()=>{};
const closeRequested=new Promise<void>(resolve=>{notifyClose=resolve});
const requestClose=()=>{requested=true;notifyClose()};
const terminate=()=>{signalled=true;process.exitCode=143;requestClose()};
const message=(value:unknown)=>{if(value==='close')requestClose()};
process.once('SIGTERM',terminate);process.on('message',message);
try{
 edge=Bun.serve({hostname:'127.0.0.1',port:0,tls:{key:Bun.file('./fixture-key.pem'),cert:Bun.file('./fixture-cert.pem')},async fetch(request){
  if(!server)return new Response('starting',{status:503});
  const headers=new Headers(request.headers);headers.delete('content-length');headers.delete('forwarded');
  headers.set('x-forwarded-proto','https');headers.set('x-forwarded-host',headers.get('host')??'');headers.set('x-forwarded-for','127.0.0.1');
  let url:URL;try{url=new URL(request.url)}catch{return new Response('invalid authority',{status:400})}
  return fetch(new URL(url.pathname+url.search,server.url),{method:request.method,headers,...(request.method==='POST'?{body:await request.arrayBuffer()}:{}),redirect:'manual',signal:AbortSignal.timeout(10000)});
 }});
 const publicOrigin='https://forms.localhost:'+edge.port;
 process.env.APP_URL=publicOrigin;process.env.CSRF_TARGET_ORIGIN=process.env.INVALID_CSRF_TARGET??publicOrigin;
 const app=await bootstrapApp({migrate:false,mode:'http',server:{port:0,native:{hostname:'127.0.0.1'}},onConstructed:owner=>{application=owner;return undefined}});
 // Early construction also retains the owner if startup rejects.
 const constructed=application;application=app.application;server=app.server;
 assert.equal(constructed,application,'Returned boot must retain the early constructed owner');
 assert.ok(server);
 if(!requested){
  process.send?.({edge:edge.url.origin,backend:server.url.origin,publicOrigin});
  admitted=true;
 }
 await closeRequested;
 if(signalled)throw new Error('Generated probe interrupted by SIGTERM');
 if(!admitted)throw new Error('Generated probe closed before readiness');
}catch(error){failures.push(error);primaryCount=failures.length}
finally{
 try{await edge?.stop(true)}catch(error){failures.push(error)}
 try{
  if(application){const stopped=await application.stop({reason:'CSRF browser probe complete'});if(!stopped.successful)throw new Error('Generated probe application cleanup was not confirmed',{cause:stopped})}
 }catch(error){failures.push(error)}
 process.removeListener('SIGTERM',terminate);process.removeListener('message',message);
 try{if(process.connected)process.disconnect()}catch(error){failures.push(error)}
}
console.log(JSON.stringify({probeCleanupConfirmed:failures.length===primaryCount,ownerObserved:application!==undefined,admitted,signalled}));
if(signalled){
 if(failures.length===1)console.error(failures[0]);
 if(failures.length>1)console.error(new AggregateError(failures,'Generated probe startup/work/cleanup failed'));
 process.exitCode=143;
}else{
 if(failures.length===1)throw failures[0];
 if(failures.length>1)throw new AggregateError(failures,'Generated probe startup/work/cleanup failed');
 assert.ok(admitted,'Successful close requires actual admission');
}
`,
  );
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    APP_ENV: "production",
    APP_DEBUG: "false",
    DATABASE_URL: fixture.runtimeUrl,
    APP_DATABASE_URL: fixture.runtimeUrl,
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
  termination.signal.throwIfAborted();
  const child = observeChild(
    Bun.spawn([process.execPath, probe], {
      cwd: fixture.app,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      ipc(message) {
        if (
          message &&
          typeof message === "object" &&
          "edge" in message &&
          "backend" in message &&
          "publicOrigin" in message
        )
          notifyReady(message as Ready);
      },
    }),
  );
  let rejectInterrupted: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectInterrupted = reject;
  });
  const interruptReady = () => rejectInterrupted(interrupted);
  termination.signal.addEventListener("abort", interruptReady, { once: true });
  let rejectTimeout: (reason: unknown) => void = () => {};
  const expired = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timeout = setTimeout(
    () => rejectTimeout(new Error("Generated probe readiness timed out.")),
    30000,
  );
  let endpoints: Ready;
  try {
    endpoints = await Promise.race([
      ready,
      aborted,
      expired,
      child.settled.then((settled) => {
        const reasons = settled.flatMap((item) =>
          item.status === "rejected" ? [item.reason] : [],
        );
        const stderr = settled[2];
        reasons.unshift(
          new Error(
            `Generated probe exited before ready: ${stderr?.status === "fulfilled" ? stderr.value : "stderr unavailable"}`,
          ),
        );
        throwFailures(
          reasons,
          "Generated probe exited before readiness and stream observation failed.",
        );
        throw new Error("Unreachable readiness result");
      }),
    ]);
    termination.signal.throwIfAborted();
  } finally {
    clearTimeout(timeout);
    termination.signal.removeEventListener("abort", interruptReady);
  }
  const host = new URL(endpoints.publicOrigin).host;
  const formPath = "/proxy-form/na%C3%AFve";
  const get = await ownedFetch(endpoints.edge + formPath, { tls: { ca }, headers: { Host: host } });
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
    return ownedFetch(endpoints.edge + formPath, {
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
  const unknown = await ownedFetch(endpoints.edge + formPath, {
    tls: { ca },
    headers: { Host: "evil.example.test" },
  });
  assert.equal(unknown.status, 403);
  assert.equal(unknown.headers.getSetCookie().length, 0);
  const direct = await ownedFetch(endpoints.backend + formPath, {
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
  for (const host of ["forms.localhost,evil.example.test", "user@forms.localhost"]) {
    const rejected = await ownedFetch(endpoints.backend + formPath, { headers: { Host: host } });
    malformedWireStatuses.push(rejected.status);
    assert.equal(rejected.headers.getSetCookie().length, 0);
  }
  assert.deepEqual(malformedWireStatuses, [403, 400]);

  browser = await chromium.launch({
    headless: true,
  });
  browserContext = await browser.newContext({ ignoreHTTPSErrors: true });
  {
    const page = await browserContext.newPage();
    assert.equal((await page.goto(endpoints.publicOrigin + formPath))?.status(), 200);
    const cookies = await browserContext.cookies(endpoints.publicOrigin);
    assert.equal(cookies.length, 1);
    assert.equal(cookies[0]?.secure, true);
    assert.equal(cookies[0]?.httpOnly, true);
    const actions = await Promise.allSettled([
      page.waitForResponse((response) => response.request().method() === "POST"),
      page.getByRole("button", { name: "Submit" }).click(),
    ] as const);
    throwFailures(
      actions.flatMap((action) => (action.status === "rejected" ? [action.reason] : [])),
      "Browser response/click failed.",
    );
    const responseResult = actions[0];
    assert.equal(responseResult.status, "fulfilled");
    const response = responseResult.value;
    assert.equal(response.status(), 422);
    assert.equal((await response.json()).protocol, "http:");
  }
  await browserContext.close();
  browserContext = undefined;
  await browser.close();
  browser = undefined;
  const closed = await joinChild(child, "ipc");
  assert.equal(closed.code, 0, `Generated probe close: ${closed.stdout}${closed.stderr}`);
  termination.signal.throwIfAborted();
  const invalid = observeChild(
    Bun.spawn([process.execPath, probe], {
      cwd: fixture.app,
      env: { ...env, INVALID_CSRF_TARGET: "https://forms.localhost/path" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    }),
  );
  const {
    stdout: invalidOut,
    stderr: invalidError,
    code: invalidCode,
  } = await joinChild(invalid, "exit");
  assert.notEqual(invalidCode, 0);
  assert.match(invalidOut + invalidError, /CSRF targetOrigin must be/);
  assert.match(
    invalidOut,
    /"probeCleanupConfirmed":true/,
    "Expected config refusal must also confirm cleanup.",
  );
  assert.match(invalidOut, /"admitted":false/, "Invalid target must fail before admission.");
  assert.match(
    invalidOut,
    /"ownerObserved":true/,
    "Invalid startup must observe the constructed application owner.",
  );
  result = {
    version: publishedVersion ?? "candidate-packages",
    generatedProvider: true,
    adapter: false,
    browser: 422,
    validForm: 422,
    securityControls: true,
    nativeParams: true,
    invalidStartupRefused: true,
    malformedHostControls: true,
  };
} catch (error) {
  failures.push(error);
} finally {
  try {
    await browserContext?.close();
  } catch (error) {
    failures.push(error);
  }
  try {
    await browser?.close();
  } catch (error) {
    failures.push(error);
  }
  for (const owner of children) {
    if (!owner.joined) {
      try {
        const outcome = await joinChild(owner, "terminate");
        if (outcome.code !== 143 || !outcome.stdout.includes('"probeCleanupConfirmed":true'))
          failures.push(
            new Error(
              `Generated probe emergency cleanup exited ${outcome.code}: ${outcome.stdout}${outcome.stderr}`,
            ),
          );
      } catch (error) {
        failures.push(error);
      }
    }
  }
  try {
    await fixture.close();
  } catch (error) {
    failures.push(error);
  }
  process.removeListener("SIGTERM", terminate);
  if (termination.signal.aborted && !failures.some((error) => Object.is(error, interrupted)))
    failures.push(interrupted);
}
throwFailures(failures, "CSRF browser qualification and owned cleanup failed.");
assert.ok(result);
console.log(JSON.stringify(result));
