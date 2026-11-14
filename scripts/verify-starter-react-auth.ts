/** Mounted React acceptance against real generated account endpoints, never mocked auth. */
import assert from "node:assert/strict";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, Response as BrowserResponse, Page } from "playwright";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";
import { installerEnvironment } from "./installer-environment";

const auth = process.argv.find((a) => a.startsWith("--auth="))?.slice(7);
const frontend = process.argv.find((a) => a.startsWith("--frontend="))?.slice(11);
assert.ok(
  auth && ["headers", "cookie", "token", "jwt", "cookie-token", "cookie-token-jwt"].includes(auth),
);
assert.ok(frontend === "spa-react" || frontend === "hybrid");
const dev = process.argv.includes("--dev");
const mfa = process.argv.includes("--mfa");
const expiry = process.argv.includes("--expiry");
const database = process.argv.find((a) => a.startsWith("--database="))?.slice(11) ?? "sqlite";
const tenancy = process.argv.find((a) => a.startsWith("--tenancy="))?.slice(10) ?? "none";
assert.ok(database === "sqlite" || database === "mysql" || database === "postgres");
assert.ok(
  tenancy === "none" || tenancy === "column" || (tenancy === "rls" && database === "postgres"),
);
const publishedVersion = process.argv.find((a) => a.startsWith("--published="))?.slice(12);
const fixture = await createGeneratedSecurityApp(
  database,
  [
    `--frontend=${frontend}`,
    `--auth=${auth}`,
    `--tenancy=${tenancy}`,
    "--cache=array",
    "--queue=sync",
    "--mail=log",
    "--no-docker",
    mfa ? "--mfa" : "--no-mfa",
    "--no-email-verification",
    "--no-scim",
    "--no-metrics",
  ],
  { publishedVersion },
);
let reserve: ReturnType<typeof Bun.serve> | undefined;
let frontendReserve: ReturnType<typeof Bun.serve> | undefined;
let origin = "",
  browserOrigin = "";
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([k]) =>
      ["PATH", "HOME", "TMPDIR", "USER", "SHELL"].includes(k),
    ),
  ),
  APP_ENV: "local",
  APP_URL: origin,
  PORT: "0",
  HOST: "127.0.0.1",
  DATABASE_URL: fixture.runtimeUrl,
  APP_DATABASE_URL: fixture.runtimeUrl,
  MIGRATION_DATABASE_URL: "",
  SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID(),
  JWT_SECRET: crypto.randomUUID() + crypto.randomUUID(),
  TOKEN_HASH_PEPPER: crypto.randomUUID(),
  AUTH_DEV_HEADERS: "true",
  JWT_TTL_SECONDS: expiry ? "2" : "3600",
  TENANCY_DRIVER: tenancy,
  OTEL_SDK_DISABLED: "true",
};
const installerEnv = installerEnvironment();
const failures: unknown[] = [];
type PipedChild = ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>;
interface OwnedChild {
  child: PipedChild;
  observation: Promise<PromiseSettledResult<unknown>[]>;
  output: string;
  error: string;
  label: string;
  listener: string;
  group: boolean;
  stopRequested: boolean;
  terminal?: PromiseSettledResult<number>;
}
const activeCommands = new Set<PipedChild>();
let server: OwnedChild | undefined, devServer: OwnedChild | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
let interrupted = false,
  fixtureSafe = true;
const interruption = new Error("Mounted React verification interrupted by SIGTERM.");
const cancellation = new AbortController();
let terminationTimer: ReturnType<typeof setTimeout> | undefined;
const responseTasks = new Set<Promise<void>>();
const responseFailures: unknown[] = [];
function throwFailures(errors: unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}
function checkInterrupted(): void {
  if (interrupted) throw interruption;
}
function hasExited(owner: OwnedChild): boolean {
  return owner.terminal?.status === "fulfilled" || owner.child.exitCode !== null;
}
function signalChild(owner: OwnedChild, signal: NodeJS.Signals): void {
  try {
    if (signal === "SIGTERM" && !hasExited(owner)) owner.stopRequested = true;
    if (owner.group) process.kill(-owner.child.pid, signal);
    else if (!hasExited(owner)) owner.child.kill(signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
const terminate = () => {
  interrupted = true;
  process.exitCode = 143;
  cancellation.abort(interruption);
  for (const owner of [server, devServer])
    if (owner)
      try {
        signalChild(owner, "SIGTERM");
      } catch (error) {
        failures.push(error);
      }
  for (const child of activeCommands)
    try {
      if (child.exitCode === null) child.kill("SIGTERM");
    } catch (error) {
      failures.push(error);
    }
  terminationTimer ??= setTimeout(() => {
    for (const owner of [server, devServer])
      if (owner)
        try {
          signalChild(owner, "SIGKILL");
        } catch (error) {
          failures.push(error);
        }
    for (const child of activeCommands)
      try {
        if (child.exitCode === null) child.kill("SIGKILL");
      } catch (error) {
        failures.push(error);
      }
  }, 10000);
};
process.once("SIGTERM", terminate);
function http(input: string, init: RequestInit = {}): Promise<Response> {
  checkInterrupted();
  return fetch(input, {
    ...init,
    signal: AbortSignal.any([cancellation.signal, init.signal ?? AbortSignal.timeout(10000)]),
  });
}
async function command(
  args: string[],
  commandEnv: Record<string, string | undefined> = env,
): Promise<void> {
  checkInterrupted();
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: fixture.app,
    env: commandEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 90000,
    killSignal: "SIGKILL",
  });
  activeCommands.add(child);
  try {
    const results = await Promise.allSettled([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ] as const);
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    const [terminal, out, err] = results;
    const output =
      (out.status === "fulfilled" ? out.value : "") + (err.status === "fulfilled" ? err.value : "");
    if (terminal.status === "fulfilled")
      try {
        assert.equal(terminal.value, 0, `Installed React child ${args[0]} failed:\n${output}`);
      } catch (error) {
        errors.push(error);
      }
    if (interrupted) errors.push(interruption);
    throwFailures(errors, "React child exit/output collection failed.");
  } finally {
    activeCommands.delete(child);
  }
}
async function capture(
  stream: ReadableStream<Uint8Array>,
  append: (value: string) => void,
): Promise<void> {
  const reader = stream.getReader(),
    decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      append(decoder.decode(value, { stream: true }));
    }
    append(decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
function observe(child: PipedChild, label: string, listener: string, group = false): OwnedChild {
  const owner: OwnedChild = {
    child,
    label,
    listener,
    group,
    stopRequested: false,
    output: "",
    error: "",
    observation: Promise.resolve([]),
  };
  const exited = child.exited.then(
    (code) => {
      owner.terminal = { status: "fulfilled", value: code };
      return code;
    },
    (reason) => {
      owner.terminal = { status: "rejected", reason };
      throw reason;
    },
  );
  owner.observation = Promise.allSettled([
    exited,
    capture(child.stdout, (value) => {
      owner.output = (owner.output + value).slice(-32768);
    }),
    capture(child.stderr, (value) => {
      owner.error = (owner.error + value).slice(-32768);
    }),
  ]);
  return owner;
}
async function ready(owner: OwnedChild, path: string): Promise<void> {
  let available = false,
    status = "No HTTP response";
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    checkInterrupted();
    try {
      const response = await http(owner.listener + path, { signal: AbortSignal.timeout(1000) });
      available = response.ok;
      status = `${response.status}: ${await response.text()}`;
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
    if (available || owner.terminal !== undefined || hasExited(owner)) break;
    await Bun.sleep(100);
  }
  checkInterrupted();
  assert.ok(
    available && owner.terminal === undefined && !hasExited(owner),
    `${owner.label} must become ready (${status}; exit ${owner.child.exitCode}):\n${owner.output}\n${owner.error}`,
  );
}
const cli = join(fixture.app, "node_modules/@getstrata/cli/cli.ts");
async function start(): Promise<void> {
  checkInterrupted();
  assert.equal(server, undefined, "Join the previous immutable backend before reboot.");
  server = observe(
    Bun.spawn([process.execPath, cli, "start"], {
      cwd: fixture.app,
      // Official LOCAL start owns schema setup; runtime database URLs remain restricted.
      env: { ...env, MIGRATION_DATABASE_URL: fixture.migrationUrl },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    }),
    "Official backend CLI",
    origin,
  );
  await ready(server, "/health");
}
async function liveGroup(pid: number): Promise<number[]> {
  const live: number[] = [];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    let stat: string;
    try {
      stat = await readFile(`/proc/${entry}/stat`, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const fields = stat
      .slice(stat.lastIndexOf(")") + 1)
      .trim()
      .split(/\s+/);
    if (Number(fields[2]) === pid && fields[0] !== "Z" && fields[0] !== "X")
      live.push(Number(entry));
  }
  return live;
}
async function stopChild(owner: OwnedChild | undefined): Promise<void> {
  if (!owner) return;
  const errors: unknown[] = [];
  const requested = owner.stopRequested || !hasExited(owner);
  let forced = false,
    joined = false;
  try {
    signalChild(owner, "SIGTERM");
  } catch (error) {
    errors.push(error);
  }
  const timer = setTimeout(() => {
    if (joined) return;
    forced = true;
    try {
      signalChild(owner, "SIGKILL");
    } catch (error) {
      errors.push(error);
    }
  }, 10000);
  try {
    const results = await owner.observation;
    joined = true;
    for (const result of results) if (result.status === "rejected") errors.push(result.reason);
    const terminal = results[0];
    if (terminal?.status === "fulfilled")
      try {
        assert.ok(requested, `${owner.label} exited before its owned stop request.`);
        assert.equal(forced, false, `${owner.label} must stop without forced SIGKILL.`);
        if (owner.group)
          assert.ok(
            terminal.value === 0 || terminal.value === 143 || owner.child.signalCode === "SIGTERM",
            `${owner.label} unexpected exit ${terminal.value}/${owner.child.signalCode}`,
          );
        else
          assert.equal(
            terminal.value,
            0,
            `${owner.label} must drain and exit successfully:\n${owner.output}\n${owner.error}`,
          );
        console.log(
          JSON.stringify({
            reactOwnedShutdown: owner.label,
            code: terminal.value,
            signal: owner.child.signalCode,
          }),
        );
      } catch (error) {
        errors.push(error);
      }
    // Bun can fulfill exited with 143/SIGTERM while exitCode remains null.
    if (terminal?.status !== "fulfilled") {
      fixtureSafe = false;
      errors.push(new Error(`${owner.label} exit was not confirmed.`));
    }
    if (owner.group) {
      let members = await liveGroup(owner.child.pid);
      const deadline = Date.now() + 2000;
      while (members.length && Date.now() < deadline) {
        await Bun.sleep(100);
        members = await liveGroup(owner.child.pid);
      }
      if (members.length) {
        errors.push(
          new Error(`${owner.label} retained live process-group members: ${members.join(",")}`),
        );
        signalChild(owner, "SIGKILL");
        const forcedDeadline = Date.now() + 2000;
        while (members.length && Date.now() < forcedDeadline) {
          await Bun.sleep(100);
          members = await liveGroup(owner.child.pid);
        }
        if (members.length) fixtureSafe = false;
      }
    }
  } catch (error) {
    errors.push(error);
    fixtureSafe = false;
  } finally {
    clearTimeout(timer);
  }
  try {
    await assert.rejects(
      () =>
        fetch(owner.listener + (owner.group ? "/app/" : "/health"), {
          signal: AbortSignal.timeout(2000),
        }),
      `${owner.label} listener must stop before fixture removal or reboot.`,
    );
  } catch (error) {
    errors.push(error);
    fixtureSafe = false;
  }
  throwFailures(errors, `${owner.label} shutdown failed.`);
}
const responseLog = (response: BrowserResponse): void => {
  if (response.status() < 400 || !new URL(response.url()).pathname.startsWith("/api/")) return;
  const task = (async () => {
    const error = await response.finished();
    if (error) throw error;
    // Only route/status diagnostics: never serialize auth bodies or request headers.
    console.log(`HTTP ${new URL(response.url()).pathname}: ${response.status()}`);
  })().catch((error) => {
    responseFailures.push(error);
  });
  responseTasks.add(task);
  void task.then(() => responseTasks.delete(task));
};
const accountProbe = `import assert from 'node:assert/strict';
import type {Application} from '@getstrata/core/contracts/application';
import type {SelectedSession} from '@getstrata/core/contracts/persistence';
import {bootstrapApp} from './src/bootstrap/createApp.ts';
import {User} from './src/models/User.ts';
${auth === "token" ? "import {ApiToken} from './src/models/ApiToken.ts';\nimport {hashApiToken} from '@getstrata/core/auth/tokenHash';\n" : ""}assert.equal(process.env.MIGRATION_DATABASE_URL??'','');
const envelope={kind:'command' as const,actor:{kind:'system' as const,policy:'fixture.react-account-state'}${tenancy !== "none" ? ",tenant:{id:1,slug:'default'}" : ""}};
let owner:Application|undefined;const errors:unknown[]=[];
try{
 const app=await bootstrapApp({migrate:false,mode:'command',onConstructed:application=>{owner=application;return undefined;}});
 await app.invoke(envelope,async({database${tenancy === "rls" ? ",policy" : ""}})=>{
  const mutate=async(selected:SelectedSession)=>{
   const user=await selected.model(User).where({email:'demo@example.com'${tenancy !== "none" ? ",tenant_id:1" : ""}}).first();assert.ok(user,'Missing fixture user');
   ${
     auth === "token"
       ? `if(process.argv.includes('--expire-token')){
    const plain=process.env.REACT_ACCEPTANCE_TOKEN;assert.ok(plain);
    const tokens=selected.model(ApiToken);const token=await tokens.where({user_id:user.get('id'),token_hash:hashApiToken(plain)}).first();
    assert.ok(token,'Only the actual browser fixture credential may be expired.');
    await token.update({expires_at:'2000-01-01 00:00:00'});
   }else `
       : ""
}{await user.update({is_active:process.argv.includes('--active')});}
  };
  await ${tenancy === "rls" ? "policy.run(database,{kind:'tenant',tenantId:1},mutate)" : "mutate(database)"};
 });
}catch(error){errors.push(error);}
if(owner)try{const stopped=await owner.stop({reason:'React account state probe complete'});if(!stopped.successful)throw new Error('React account owner did not stop cleanly',{cause:stopped});}catch(error){errors.push(error);}
if(errors.length===1)throw errors[0];if(errors.length>1)throw new AggregateError(errors,'React account state and cleanup failed.');
`;
try {
  checkInterrupted();
  reserve = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reserve.port;
  assert.ok(port);
  await reserve.stop(true);
  reserve = undefined;
  origin = `http://127.0.0.1:${port}`;
  browserOrigin = origin;
  env.APP_URL = origin;
  env.PORT = String(port);
  await writeFile(
    join(fixture.app, ".env"),
    (await readFile(join(fixture.app, ".env.example"), "utf8")).replace(
      /^MIGRATION_DATABASE_URL=.*$/gm,
      "MIGRATION_DATABASE_URL=",
    ),
  );
  // Test bridge invokes the shipped client in the same browser module graph as AuthContext.
  await appendFile(
    join(fixture.app, "frontend/src/main.tsx"),
    '\nimport {apiFetch as acceptanceFetch,fetchResourceEtag as acceptanceEtag} from "./api/client";\nObject.assign(window,{acceptanceFetch,acceptanceEtag});\n',
  );
  await mkdir(join(fixture.app, "src/modules/acceptance"), { recursive: true });
  await writeFile(
    join(fixture.app, "src/modules/acceptance/index.ts"),
    `import type {AppModule} from '@getstrata/bootstrap/contracts';
import {jsonResponse} from '@getstrata/core/http/response';
import {parseJsonBody} from '@getstrata/core/http/validation';
import {Note} from '../../models/Note.ts';
export default {name:'acceptance',routes({kernel}){return {
'/api/v1/acceptance-identity':{GET:kernel.wrapApi(async(request,ports)=>{const user=await ports.auth.requireUser(request);return jsonResponse({id:user.id,role:user.role},{headers:{etag:'identity-v1'}});})},
'/api/v1/acceptance-notes':{POST:kernel.wrapApi(async(request,ports)=>{await ports.auth.requireUser(request);const input=await parseJsonBody(request,value=>value as {body:string});const note=await ports.database.model(Note).create({body:input.body${tenancy !== "none" ? ",tenant_id:ports.established.tenant.id" : ""}});return jsonResponse(note.toObject(),{status:201});})}
};}} satisfies AppModule;`,
  );
  // Compile and exercise the ORM example shown to developers, rather than assuming it works.
  const { notesModuleExample } = await import(join(fixture.app, "frontend/src/examples/notes.ts"));
  const { TENANCY_ENABLED } = await import(join(fixture.app, "frontend/src/config.ts"));
  assert.equal(TENANCY_ENABLED, tenancy !== "none");
  const example = notesModuleExample(TENANCY_ENABLED);
  assert.equal(typeof example, "string");
  await mkdir(join(fixture.app, "src/modules/notes"));
  await writeFile(join(fixture.app, "src/modules/notes/index.ts"), example);
  await command(["run", "check"]);
  await command(["run", "db:migrate", "--seed"], {
    ...env,
    DATABASE_URL: fixture.migrationUrl,
    APP_DATABASE_URL: fixture.migrationUrl,
    MIGRATION_DATABASE_URL: fixture.migrationUrl,
  });
  if (mfa) {
    const cli = join(fixture.app, "node_modules/@getstrata/cli/cli.ts");
    await command([cli, "openapi:generate"]);
    await command([cli, "openapi:check"]);
    const spec = JSON.parse(await readFile(join(fixture.app, "docs/openapi.json"), "utf8"));
    for (const path of [
      "/api/v1/auth/register",
      "/api/v1/auth/confirm-password",
      "/api/v1/auth/mfa",
    ])
      assert.ok(spec.paths[path], `Missing JSON account operation ${path}`);
    for (const path of ["/login", "/register", "/account/mfa"])
      assert.equal(spec.paths[path], undefined, "HTML account pages stay outside OpenAPI");
  }
  if (tenancy !== "none") {
    await writeFile(
      join(fixture.app, "other-tenant.ts"),
      `import assert from 'node:assert/strict';
import type {Application} from '@getstrata/core/contracts/application';
import type {SelectedSession} from '@getstrata/core/contracts/persistence';
import {BaseRepository} from '@getstrata/core/database/baseRepository';
import {defineRepository} from '@getstrata/core/database/definitions';
import {defineTable} from '@getstrata/core/database/table';
import {bootstrapApp} from './src/bootstrap/createApp.ts';
import {Note} from './src/models/Note.ts';
assert.equal(process.env.MIGRATION_DATABASE_URL??'','');
const tenants=defineRepository({name:'FixtureBrowserTenants',table:defineTable<{id:number;slug:string},'id'>({name:'tenant',primaryKey:'id',columns:['id','slug']}),dependencies:[],create:binding=>new BaseRepository(binding)});
const envelope={kind:'command' as const,actor:{kind:'system' as const,policy:'fixture.react-other-tenant'}};
let owner:Application|undefined;const errors:unknown[]=[];
try{
 const app=await bootstrapApp({migrate:false,mode:'command',persistence:{repositories:[tenants]},onConstructed:application=>{owner=application;return undefined;}});
 const other=await app.invoke(envelope,async({database})=>{const tenant=await database.repository(tenants).create({slug:'browser-other'});assert.equal(tenant.id,2);return tenant;});
 await app.invoke({...envelope,tenant:{id:other.id,slug:other.slug}},async({database${tenancy === "rls" ? ",policy" : ""}})=>{
  const create=async(selected:SelectedSession)=>{
   const note=await selected.model(Note).create({body:'other-tenant-note',tenant_id:other.id});assert.equal(note.get('tenant_id'),2);
   const notes=await selected.model(Note).where({tenant_id:other.id}).get();assert.deepEqual(notes.map(note=>note.get('body')),['other-tenant-note']);
  };
  await ${tenancy === "rls" ? "policy.run(database,{kind:'tenant',tenantId:other.id},create)" : "create(database)"};
 });
}catch(error){errors.push(error);}
if(owner)try{const stopped=await owner.stop({reason:'React other tenant fixture complete'});if(!stopped.successful)throw new Error('React tenant owner did not stop cleanly',{cause:stopped});}catch(error){errors.push(error);}
if(errors.length===1)throw errors[0];if(errors.length>1)throw new AggregateError(errors,'React tenant fixture and cleanup failed.');
`,
    );
    await command(["other-tenant.ts"]);
  }
  await command(["run", "frontend:install"], installerEnv);
  await command(["run", "frontend:build"]);
  await command([
    join(fixture.app, "node_modules/typescript/bin/tsc"),
    "--noEmit",
    "-p",
    "frontend/tsconfig.json",
  ]);
  await start();
  if (dev) {
    checkInterrupted();
    frontendReserve = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const frontendPort = frontendReserve.port;
    assert.ok(frontendPort);
    await frontendReserve.stop(true);
    frontendReserve = undefined;
    browserOrigin = `http://127.0.0.1:${frontendPort}`;
    devServer = observe(
      Bun.spawn([process.execPath, "run", "frontend:dev"], {
        cwd: fixture.app,
        env: { ...env, API_ORIGIN: origin, FRONTEND_PORT: String(frontendPort) },
        detached: true,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      }),
      "Official frontend dev process group",
      browserOrigin,
      true,
    );
    await ready(devServer, "/app/");
  }
  checkInterrupted();
  const { chromium } = await import("playwright");
  checkInterrupted();
  browser = await chromium.launch();
  checkInterrupted();
  page = await browser.newPage();
  const mountedPage = page;
  mountedPage.setDefaultTimeout(7000);
  const errors: string[] = [];
  mountedPage.on("pageerror", (e) => errors.push(e.message));
  mountedPage.on("response", responseLog);
  let issuedToken: string | undefined;
  const calls: string[] = [];
  mountedPage.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/api")) calls.push(path);
    if (auth === "token" && path === "/api/v1/acceptance-identity") {
      const task = (async () => {
        const authorization = await r.headerValue("authorization");
        assert.ok(
          typeof authorization === "string" && authorization.startsWith("Bearer "),
          "The actual opaque browser request must carry its credential.",
        );
        issuedToken = authorization.slice(7);
      })().catch((error) => {
        responseFailures.push(error);
      });
      responseTasks.add(task);
      void task.then(() => responseTasks.delete(task));
    }
  });
  await mountedPage.goto(`${browserOrigin}/app/`);
  if (auth !== "headers") {
    const csrf = await mountedPage.request.get(`${browserOrigin}/api/v1/auth/csrf`);
    assert.equal(csrf.status(), 200);
    const { token } = (await csrf.json()) as { token: string };
    const crossSite = await mountedPage.request.post(
      `${browserOrigin}${auth === "jwt" ? "/api/auth/token" : "/api/v1/auth/login"}`,
      {
        headers: { origin: "https://untrusted.example.test", "x-csrf-token": token },
        data: { email: "demo@example.com", password: "StrataDemo!ChangeMe" },
      },
    );
    assert.equal(
      crossSite.status(),
      403,
      "Proxy and built runtime must retain cross-site CSRF refusal",
    );
  }
  if (auth === "headers") {
    await mountedPage.getByRole("heading", { name: "Development identity", exact: true }).waitFor();
    assert.equal(await mountedPage.locator("input[type=password]").count(), 0);
    await mountedPage.getByLabel("User ID", { exact: true }).fill("42");
    await mountedPage.getByRole("button", { name: "Use development identity" }).click();
  } else {
    await mountedPage.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
    await mountedPage.getByLabel("Email", { exact: true }).fill("demo@example.com");
    await mountedPage.getByLabel("Password", { exact: true }).fill("Wrong!Password123");
    await mountedPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await mountedPage.getByText("Invalid credentials", { exact: true }).waitFor();
    await mountedPage.getByLabel("Password", { exact: true }).fill("StrataDemo!ChangeMe");
    await mountedPage.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await mountedPage.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  const identity = await mountedPage.evaluate(async () => {
    const w = globalThis as unknown as {
      acceptanceFetch: (p: string) => Promise<{ id: number | string; role: string }>;
    };
    return w.acceptanceFetch("/acceptance-identity");
  });
  assert.ok(identity.id);
  assert.equal(
    await mountedPage.locator("pre code").textContent(),
    example,
    "Compile and execute exactly the source shown in the real browser",
  );
  const etag = await mountedPage.evaluate(async () =>
    (globalThis as unknown as { acceptanceEtag: (p: string) => Promise<string> }).acceptanceEtag(
      "/acceptance-identity",
    ),
  );
  assert.equal(etag, "identity-v1", "ETag fetch must use the selected authenticated transport");
  const created = await mountedPage.evaluate(async () =>
    (
      globalThis as unknown as {
        acceptanceFetch: (
          path: string,
          options: RequestInit,
        ) => Promise<{ id: number; body: string }>;
      }
    ).acceptanceFetch("/acceptance-notes", {
      method: "POST",
      body: JSON.stringify({ body: "browser-authenticated-write" }),
    }),
  );
  assert.ok(created.id);
  assert.equal(created.body, "browser-authenticated-write");
  const notes = await mountedPage.evaluate(async () =>
    (
      globalThis as unknown as { acceptanceFetch: (p: string) => Promise<{ data: unknown[] }> }
    ).acceptanceFetch("/notes"),
  );
  assert.ok(
    Array.isArray(notes.data),
    "The displayed ORM example must actually serve its resource",
  );
  assert.ok(
    notes.data.some((note) => (note as { id: number }).id === created.id),
    "Authenticated client writes must be visible through the displayed ORM resource",
  );
  if (tenancy !== "none") {
    assert.ok(
      notes.data.every((note) => (note as { tenant_id: number }).tenant_id === 1),
      "The displayed tenant resource must not expose another tenant's rows",
    );
  }

  if (auth === "headers") {
    assert.equal(String(identity.id), "42");
    assert.ok(
      !calls.some((p) => p.includes("/auth/")),
      "Header UI must not call absent account/CSRF endpoints",
    );
  }
  assert.deepEqual(
    await mountedPage.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    })),
    { local: [], session: [] },
    "Credentials remain memory only",
  );
  async function loginAgain(code?: string) {
    await mountedPage.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
    await mountedPage.getByLabel("Email", { exact: true }).fill("demo@example.com");
    await mountedPage.getByLabel("Password", { exact: true }).fill("StrataDemo!ChangeMe");
    if (code)
      await mountedPage.getByLabel("Authenticator or recovery code", { exact: true }).fill(code);
    await mountedPage.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  if (auth !== "headers" && !mfa) {
    if (auth === "token" || expiry) {
      if (auth === "token") {
        await Promise.allSettled([...responseTasks]);
        assert.ok(
          issuedToken,
          "Expiry must select the opaque credential sent by this real browser.",
        );
        await writeFile(join(fixture.app, "account-state.ts"), accountProbe);
        await command(["account-state.ts", "--expire-token"], {
          ...env,
          REACT_ACCEPTANCE_TOKEN: issuedToken,
        });
      } else await Bun.sleep(2200);
      const expired = await mountedPage.evaluate(async () => {
        try {
          await (
            globalThis as unknown as { acceptanceFetch: (p: string) => Promise<unknown> }
          ).acceptanceFetch("/acceptance-identity");
          return 200;
        } catch (error) {
          return (error as { status: number }).status;
        }
      });
      assert.equal(expired, 401, "Expired real credentials must be rejected");
      await loginAgain();
      await mountedPage.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    }
    // Administrative account state changes select only the fixture account and its trusted tenant.
    await writeFile(join(fixture.app, "account-state.ts"), accountProbe);
    await command(["account-state.ts"]);
    const revoked = await mountedPage.evaluate(async () => {
      try {
        await (
          globalThis as unknown as { acceptanceFetch: (p: string) => Promise<unknown> }
        ).acceptanceFetch("/acceptance-identity");
        return 200;
      } catch (error) {
        return (error as { status: number }).status;
      }
    });
    assert.equal(revoked, 401, "Disabled accounts must invalidate UI on a real guard rejection");
    await mountedPage.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
    await command(["account-state.ts", "--active"]);
    await loginAgain();
    await mountedPage.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  }
  if (mfa) {
    const setup = await mountedPage.evaluate(async () => {
      const api = (
        globalThis as unknown as {
          acceptanceFetch: (p: string, o?: RequestInit) => Promise<{ secret: string }>;
        }
      ).acceptanceFetch;
      await api("/auth/confirm-password", {
        method: "POST",
        body: JSON.stringify({ password: "StrataDemo!ChangeMe" }),
      });
      return api("/auth/mfa");
    });
    const { generateTotp } = await import(fixture.resolve("@getstrata/core/security/totp"));
    const enrolled = await mountedPage.evaluate(
      async ({ secret, code }) =>
        (
          globalThis as unknown as {
            acceptanceFetch: (p: string, o?: RequestInit) => Promise<{ recoveryCodes: string[] }>;
          }
        ).acceptanceFetch("/auth/mfa", { method: "POST", body: JSON.stringify({ secret, code }) }),
      { secret: setup.secret, code: generateTotp(setup.secret) },
    );
    const recovery = enrolled.recoveryCodes[0];
    assert.ok(recovery);
    await mountedPage.getByRole("button", { name: "Sign out", exact: true }).click();
    await loginAgain();
    await mountedPage.getByText("mfa_required", { exact: true }).waitFor();
    await mountedPage.getByLabel("Authenticator or recovery code", { exact: true }).fill(recovery);
    await mountedPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await mountedPage.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    await mountedPage.getByRole("button", { name: "Sign out", exact: true }).click();
    await loginAgain(recovery);
    await mountedPage.getByText("mfa_invalid", { exact: true }).waitFor();
    await mountedPage
      .getByLabel("Authenticator or recovery code", { exact: true })
      .fill(generateTotp(setup.secret));
    await mountedPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await mountedPage.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  }
  await mountedPage.reload();
  if (auth === "token" || auth === "jwt" || auth === "headers") {
    await mountedPage
      .getByRole("heading", {
        name: auth === "headers" ? "Development identity" : "Sign in",
        exact: true,
      })
      .waitFor();
  } else {
    await mountedPage.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    await mountedPage.getByRole("button", { name: "Sign out", exact: true }).click();
    await mountedPage.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
  }
  if (auth === "token" || auth === "jwt") {
    await loginAgain();
    await mountedPage.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    await mountedPage.getByRole("button", { name: "Sign out", exact: true }).click();
    await mountedPage.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
  }
  if (auth === "headers") {
    await mountedPage.getByLabel("User ID", { exact: true }).fill("42");
    await mountedPage.getByRole("button", { name: "Use development identity" }).click();
    await mountedPage.getByRole("button", { name: "Sign out", exact: true }).click();
    await mountedPage.getByRole("heading", { name: "Development identity", exact: true }).waitFor();
    await mountedPage.getByLabel("User ID", { exact: true }).fill("42");
    await mountedPage.getByRole("button", { name: "Use development identity" }).click();
    await stopChild(server);
    server = undefined;
    env.AUTH_DEV_HEADERS = "false";
    await start();
    const denied = await mountedPage.evaluate(async () => {
      try {
        await (
          globalThis as unknown as { acceptanceFetch: (p: string) => Promise<unknown> }
        ).acceptanceFetch("/acceptance-identity");
        return 200;
      } catch (error) {
        return (error as { status: number }).status;
      }
    });
    assert.equal(
      denied,
      401,
      "A client-side identity must never bypass disabled server header auth",
    );
    await mountedPage.getByRole("heading", { name: "Development identity", exact: true }).waitFor();
  }
  assert.deepEqual(errors, [], "Mounted React must have no runtime errors");
  checkInterrupted();
} catch (error) {
  failures.push(error);
  for (const owner of [server, devServer])
    if (owner) console.error(`${owner.label}:\n${owner.output}\n${owner.error}`);
} finally {
  // Close the browser graph and join async diagnostics before removing any fixture resources.
  page?.removeListener("response", responseLog);
  // browser.newPage owns an implicit context: finish page disposal before browser disposal.
  const browserClosers: readonly [string, () => Promise<void> | undefined][] = [
    ["Page", () => page?.close({ runBeforeUnload: false })],
    ["Browser", () => browser?.close()],
  ];
  for (const [label, close] of browserClosers) {
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(close),
        new Promise<never>((_, reject) => {
          closeTimer = setTimeout(
            () => reject(new Error(`${label} cleanup deadline exceeded; fixture retained.`)),
            10000,
          );
        }),
      ]);
    } catch (error) {
      failures.push(error);
      fixtureSafe = false;
    } finally {
      if (closeTimer) clearTimeout(closeTimer);
    }
  }
  if (browser?.isConnected() || (page && !page.isClosed())) {
    fixtureSafe = false;
    failures.push(new Error("Browser/page remains open; fixture retained."));
  }
  let loggingTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const logged = await Promise.race([
      Promise.allSettled([...responseTasks]),
      new Promise<never>((_, reject) => {
        loggingTimer = setTimeout(
          () => reject(new Error("Browser diagnostic join deadline exceeded.")),
          10000,
        );
      }),
    ]);
    for (const result of logged) if (result.status === "rejected") failures.push(result.reason);
  } catch (error) {
    failures.push(error);
    fixtureSafe = false;
  } finally {
    if (loggingTimer) clearTimeout(loggingTimer);
  }
  failures.push(...responseFailures);
  try {
    await stopChild(devServer);
  } catch (error) {
    failures.push(error);
  }
  try {
    await stopChild(server);
  } catch (error) {
    failures.push(error);
  }
  for (const reservation of [reserve, frontendReserve])
    if (reservation)
      try {
        await reservation.stop(true);
      } catch (error) {
        failures.push(error);
      }
  if (activeCommands.size) {
    fixtureSafe = false;
    failures.push(new Error("Short children remain active; fixture retained."));
  }
  if (fixtureSafe)
    try {
      await fixture.close();
    } catch (error) {
      failures.push(error);
    }
  else
    failures.push(new Error("Fixture retained because child/browser shutdown was not confirmed."));
  if (terminationTimer) clearTimeout(terminationTimer);
  if (interrupted) failures.push(interruption);
  process.removeListener("SIGTERM", terminate);
}
throwFailures(failures, "Mounted React verification and cleanup failed.");
console.log(
  `PASS mounted ${database}/${tenancy}/${frontend}/${auth}${dev ? "/dev" : ""}${mfa ? "/mfa" : ""}${expiry ? "/expiry" : ""}: local official CLI, login, wrong password where applicable, real guard identity, reload lifetime, logout, no credential persistence and confirmed cleanup`,
);
