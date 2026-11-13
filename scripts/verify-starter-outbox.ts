/** Installed PostgreSQL/RLS publisher and official outbox:work, using real leased SQL state. */
import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";

const fixture = await createGeneratedSecurityApp("postgres", [
  "--frontend=api",
  "--auth=headers",
  "--tenancy=rls",
  "--cache=array",
  "--queue=sync",
  "--mail=log",
  "--no-docker",
  "--no-mfa",
  "--no-email-verification",
  "--no-scim",
  "--no-metrics",
]);
const env: Record<string, string | undefined> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      ["PATH", "HOME", "TMPDIR", "USER", "SHELL"].includes(key),
    ),
  ),
  APP_ENV: "local",
  APP_URL: "http://127.0.0.1:3000",
  DATABASE_URL: fixture.runtimeUrl,
  APP_DATABASE_URL: fixture.runtimeUrl,
  MIGRATION_DATABASE_URL: "",
  TENANCY_DRIVER: "rls",
  AUTH_DEV_HEADERS: "true",
  OTEL_SDK_DISABLED: "true",
};
const firstId = crypto.randomUUID(),
  secondId = crypto.randomUUID();
const eventName = "fixture.installed-outbox",
  listenerName = "fixture.installed-effect";
const failures: unknown[] = [],
  barrierFailures: unknown[] = [];
const cancellation = new AbortController();
const interruption = new Error("Installed outbox verification interrupted by SIGTERM.");
let interrupted = false,
  fixtureSafe = true;
type Child = ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>;
interface Worker {
  child: Child;
  observation: Promise<PromiseSettledResult<unknown>[]>;
  terminal?: PromiseSettledResult<number>;
  pid?: number;
  output: string;
  error: string;
  stopRequested: boolean;
  closed: boolean;
  forced: boolean;
}
const activeCommands = new Set<Child>(),
  workers: Worker[] = [];
let worker: Worker | undefined, barrier: ReturnType<typeof Bun.serve> | undefined;
let released = false;
let releaseHeld!: () => void;
const held = new Promise<void>((resolve) => {
  releaseHeld = resolve;
});
const requestTasks = new Set<Promise<Response>>();
const admissions: { id: string; pid: number; held: boolean }[] = [];
const aborts: { id: string; pid: number }[] = [];
let terminationTimer: ReturnType<typeof setTimeout> | undefined;
function throwFailures(errors: unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}
function check(): void {
  if (interrupted) throw interruption;
}
function release(): void {
  released = true;
  releaseHeld();
}
function groupSignal(owner: Worker, signal: NodeJS.Signals): void {
  try {
    process.kill(-owner.child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
const terminate = () => {
  interrupted = true;
  process.exitCode = 143;
  cancellation.abort(interruption);
  release();
  for (const owner of workers)
    if (!owner.closed && owner.terminal?.status !== "fulfilled")
      try {
        owner.stopRequested = true;
        if (owner.pid) process.kill(owner.pid, "SIGTERM");
        else owner.child.kill("SIGTERM");
      } catch (error) {
        failures.push(error);
      }
  for (const child of activeCommands)
    try {
      child.kill("SIGTERM");
    } catch (error) {
      failures.push(error);
    }
  terminationTimer ??= setTimeout(() => {
    for (const owner of workers)
      if (!owner.closed) {
        owner.forced = true;
        try {
          groupSignal(owner, "SIGKILL");
        } catch (error) {
          failures.push(error);
        }
      }
    for (const child of activeCommands)
      try {
        child.kill("SIGKILL");
      } catch (error) {
        failures.push(error);
      }
  }, 10000);
};
process.once("SIGTERM", terminate);
async function deadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
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
async function command(args: string[], extra: Record<string, string> = {}): Promise<string> {
  check();
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: fixture.app,
    env: { ...env, ...extra },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60000,
    killSignal: "SIGKILL",
  });
  activeCommands.add(child);
  let confirmed = false;
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
    confirmed = terminal.status === "fulfilled";
    const output =
      (out.status === "fulfilled" ? out.value : "") + (err.status === "fulfilled" ? err.value : "");
    if (terminal.status === "fulfilled")
      try {
        assert.equal(terminal.value, 0, `Installed outbox command ${args[0]} failed:\n${output}`);
      } catch (error) {
        errors.push(error);
      }
    else {
      fixtureSafe = false;
      try {
        child.kill("SIGTERM");
      } catch (error) {
        errors.push(error);
      }
      errors.push(new Error(`Unconfirmed short child PID ${child.pid}; fixture retained.`));
    }
    if (interrupted) errors.push(interruption);
    throwFailures(errors, "Installed outbox command/stream collection failed.");
    return out.status === "fulfilled" ? out.value : "";
  } finally {
    if (confirmed) activeCommands.delete(child);
  }
}
async function liveGroup(pid: number): Promise<number[]> {
  const members: number[] = [];
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
      members.push(Number(entry));
  }
  return members;
}
async function startWorker(): Promise<Worker> {
  check();
  assert.equal(worker, undefined, "Join the previous official command before restart.");
  const child = Bun.spawn([process.execPath, "run", "outbox:work"], {
    cwd: fixture.app,
    env: { ...env, OUTBOX_ACCEPTANCE_WORKER: "true" },
    detached: true,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const owner: Worker = {
    child,
    observation: Promise.resolve([]),
    output: "",
    error: "",
    stopRequested: false,
    closed: false,
    forced: false,
  };
  worker = owner;
  workers.push(owner);
  let pending = "";
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
      pending += value;
      let end = pending.indexOf("\n");
      while (end >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (line.startsWith("OUTBOX_ACCEPTANCE_PID ")) {
          const pid = Number(line.slice("OUTBOX_ACCEPTANCE_PID ".length));
          assert.ok(Number.isSafeInteger(pid) && pid > 0);
          owner.pid = pid;
        }
        end = pending.indexOf("\n");
      }
    }),
    capture(child.stderr, (value) => {
      owner.error = (owner.error + value).slice(-32768);
    }),
  ]);
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    check();
    if (owner.terminal) break;
    if (owner.pid && owner.output.includes("[outbox:work] Starting SQL outbox polling;"))
      return owner;
    await Bun.sleep(50);
  }
  throw new Error(
    `Official outbox command did not enter polling (not a delivery/health witness):\n${owner.output}\n${owner.error}`,
  );
}
async function signalWorker(owner: Worker): Promise<void> {
  if (owner.stopRequested) return;
  assert.equal(
    owner.terminal,
    undefined,
    "Official worker exited before its owned SIGTERM request.",
  );
  assert.ok(owner.pid, "The actual registry must identify its worker process.");
  assert.ok(
    (await liveGroup(owner.child.pid)).includes(owner.pid),
    "Signal only the actual worker in this owned command's process group.",
  );
  owner.stopRequested = true;
  process.kill(owner.pid, "SIGTERM");
}
async function stopWorker(owner: Worker): Promise<void> {
  if (owner.closed) return;
  const errors: unknown[] = [];
  let settled = false;
  try {
    if (!owner.stopRequested) await signalWorker(owner);
    const results = await deadline(
      owner.observation,
      15000,
      "Official outbox command did not join after SIGTERM.",
    );
    settled = true;
    for (const result of results) if (result.status === "rejected") errors.push(result.reason);
  } catch (error) {
    errors.push(error);
    owner.forced = true;
    try {
      groupSignal(owner, "SIGKILL");
    } catch (failure) {
      errors.push(failure);
    }
    try {
      const results = await deadline(
        owner.observation,
        5000,
        "Forced outbox command could not be joined.",
      );
      settled = true;
      for (const result of results) if (result.status === "rejected") errors.push(result.reason);
    } catch (failure) {
      errors.push(failure);
    }
  }
  let members: number[] = [];
  let groupGone = false;
  try {
    members = await liveGroup(owner.child.pid);
    const until = Date.now() + 2000;
    while (members.length && Date.now() < until) {
      await Bun.sleep(50);
      members = await liveGroup(owner.child.pid);
    }
    assert.deepEqual(members, [], "All descendants of the actual bun run command must stop.");
    groupGone = true;
  } catch (error) {
    errors.push(error);
    fixtureSafe = false;
  }
  if (!settled || owner.terminal?.status !== "fulfilled") {
    fixtureSafe = false;
    errors.push(new Error(`Unconfirmed official worker PID ${owner.child.pid}; fixture retained.`));
  } else {
    owner.closed = groupGone;
    try {
      assert.equal(owner.forced, false, "Forced kill does not prove graceful shutdown.");
      assert.equal(
        owner.terminal.value,
        0,
        `Original bun run outbox:work must finish cleanly:\n${owner.output}\n${owner.error}`,
      );
    } catch (error) {
      errors.push(error);
    }
  }
  throwFailures(errors, "Installed official outbox worker cleanup failed.");
}
interface Delivery {
  id: string;
  status: string;
  attempts: number;
  leaseUntil: number | null;
  createdAt: number;
  completedAt: number | null;
  leaseToken: string | null;
}
interface Snapshot {
  nowMs: number;
  deliveries: Delivery[];
  notes: { id: number; body: string; tenant_id: number }[];
}
async function observe(): Promise<Snapshot> {
  return JSON.parse(await command(["src/outbox-data.ts", "observe"])) as Snapshot;
}
function delivery(snapshot: Snapshot, id: string): Delivery {
  const row = snapshot.deliveries.find((item) => item.id === id);
  assert.ok(row, `Missing real delivery ${id}`);
  return row;
}
function domain(snapshot: Snapshot, id: string, kind: "producer" | "effect") {
  return snapshot.notes.filter((note) => note.body === `${kind}:${id}` && note.tenant_id === 1);
}
async function completed(id: string, timeout: number): Promise<Snapshot> {
  const until = Date.now() + timeout;
  let last: Snapshot | undefined;
  while (Date.now() < until) {
    check();
    assert.equal(
      worker?.terminal,
      undefined,
      "Official worker exited before persisted completion.",
    );
    last = await observe();
    if (delivery(last, id).status === "completed") return last;
    await Bun.sleep(500);
  }
  throw new Error(`Real delivery did not complete: ${JSON.stringify(last)}`);
}
const typeContract = `import type {BootstrappedApp} from './bootstrap/createApp.ts';
import type {DatabaseSession,TransactionSession} from '@getstrata/core/database/session';
export function publisherContract(app:BootstrappedApp,tx:TransactionSession,db:DatabaseSession):void{
 void app.outbox.publish(tx,'fixture.installed-outbox',{}, {tenantId:1});
 // @ts-expect-error Publication requires an actual transaction.
 void app.outbox.publish(db,'fixture.installed-outbox',{}, {tenantId:1});
 // @ts-expect-error The generated publisher has no polling capability.
 void app.outbox.work({signal:new AbortController().signal});
 // @ts-expect-error Replay is not an application publisher capability.
 void app.outbox.replay('event','listener');
 // @ts-expect-error The coordinator token is private to assembly.
 void app.outbox.token;
 // @ts-expect-error The generated publisher property is readonly.
 app.outbox=app.outbox;
}
`;
const registry = `import assert from 'node:assert/strict';
import type {DurableListener} from '@getstrata/core/events/outbox';
import {Note} from '../models/Note.ts';
if(process.env.OUTBOX_ACCEPTANCE_WORKER==='true')console.log('OUTBOX_ACCEPTANCE_PID '+process.pid);
const listeners:readonly DurableListener[]=[{name:${JSON.stringify(listenerName)},event:${JSON.stringify(eventName)},async handle(event,{database,signal}){
 assert.equal(event.tenantId,1);
 const payload=event.payload as {hold:boolean};assert.equal(typeof payload.hold,'boolean');
 const origin=process.env.OUTBOX_ACCEPTANCE_BARRIER;assert.ok(origin);
 const notifications:Promise<void>[]=[];const errors:unknown[]=[];
 const notify=async(path:string)=>{
  const response=await fetch(origin+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:event.id,pid:process.pid,hold:payload.hold}),signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200);await response.text();
 };
 const abort=()=>{const task=notify('/cancel');notifications.push(task);void task.catch(()=>undefined);};
 signal.addEventListener('abort',abort,{once:true});
 try{
  // Causal control removes only this domain effect write in an evidence-only generated registry.
  await database.model(Note).create({body:'effect:'+event.id,tenant_id:1});
  await notify('/admit');
  signal.throwIfAborted();
 }catch(error){errors.push(error);}
 finally{
  signal.removeEventListener('abort',abort);
  const joined=await Promise.allSettled(notifications);for(const result of joined)if(result.status==='rejected')errors.push(result.reason);
 }
 if(errors.length===1)throw errors[0];if(errors.length>1)throw new AggregateError(errors,'Installed listener and cancellation notification failed.');
}}];export {listeners};
`;
const data = `import assert from 'node:assert/strict';
import type {Application} from '@getstrata/core/contracts/application';
import {bootstrapApp} from './bootstrap/createApp.ts';
import {Note} from './models/Note.ts';
assert.equal(process.env.MIGRATION_DATABASE_URL??'','');
const ids=${JSON.stringify([firstId, secondId])};
let owner:Application|undefined,result:unknown;const errors:unknown[]=[];
try{
 const app=await bootstrapApp({migrate:false,mode:'command',onConstructed:application=>{owner=application;return undefined;}});
 assert.equal(Object.isFrozen(app.outbox),true);assert.deepEqual(Object.keys(app.outbox),['publish']);assert.equal(Object.getPrototypeOf(app.outbox),Object.prototype);
 const action=process.argv[2];
 result=await app.invoke({kind:'command',actor:{kind:'system',policy:'fixture.installed-outbox'},tenant:{id:1,slug:'default'}},({database,policy})=>policy.run(database,{kind:'tenant',tenantId:1},async selected=>{
  if(action==='publish'){
   const id=process.argv[3];assert.ok(id&&ids.includes(id));
   await selected.model(Note).create({body:'producer:'+id,tenant_id:1});
   assert.equal(await app.outbox.publish(selected,${JSON.stringify(eventName)},{hold:id===ids[1]},{id,tenantId:1}),id);
   return {id};
  }
  assert.equal(action,'observe');
  const rows=await selected.execute<{id:string;status:string;attempts:number;lease_until:number|string|null;created_at:number|string;completed_at:number|string|null;lease_token:string|null}>({text:'SELECT e.id,e.created_at,d.status,d.attempts,d.lease_until,d.completed_at,d.lease_token FROM strata_outbox_event e JOIN strata_outbox_delivery d ON d.event_id=e.id WHERE e.id IN ($1,$2) AND e.tenant_id=$3 AND d.listener_name=$4 ORDER BY e.id',params:[...ids,1,${JSON.stringify(listenerName)}]});
  const notes=await selected.model(Note).where({tenant_id:1}).get();
  const [clock]=await selected.execute<{now_ms:number|string}>({text:'SELECT '+selected.dialect.epochMillisecondsExpression()+' AS now_ms',params:[]});
  const nowMs=Number(clock?.now_ms);assert.ok(Number.isSafeInteger(nowMs));
  return {nowMs,deliveries:rows.map(row=>({id:row.id,status:row.status,attempts:Number(row.attempts),leaseUntil:row.lease_until===null?null:Number(row.lease_until),createdAt:Number(row.created_at),completedAt:row.completed_at===null?null:Number(row.completed_at),leaseToken:row.lease_token})),notes:notes.filter(note=>ids.some(id=>note.get('body')==='producer:'+id||note.get('body')==='effect:'+id)).map(note=>({id:note.get('id'),body:note.get('body'),tenant_id:note.get('tenant_id')}))};
 }));
}catch(error){errors.push(error);}
if(owner)try{const stopped=await owner.stop({reason:'Installed outbox producer/observer complete'});if(!stopped.successful)throw new Error('Installed outbox data owner did not stop cleanly',{cause:stopped});}catch(error){errors.push(error);}
if(errors.length===1)throw errors[0];if(errors.length>1)throw new AggregateError(errors,'Installed outbox data command and cleanup failed.');
console.log(JSON.stringify(result));
`;
try {
  check();
  barrier = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const task = (async () => {
        assert.equal(request.method, "POST");
        const path = new URL(request.url).pathname;
        const body = (await request.json()) as { id: string; pid: number; hold: boolean };
        assert.ok(body.id === firstId || body.id === secondId);
        assert.ok(Number.isSafeInteger(body.pid) && body.pid > 0);
        assert.ok(worker);
        assert.ok(
          (await liveGroup(worker.child.pid)).includes(body.pid),
          "Listener notification must come from the owned command's actual worker process.",
        );
        if (worker.pid === undefined) worker.pid = body.pid;
        else assert.equal(body.pid, worker.pid);
        if (path === "/cancel") {
          aborts.push({ id: body.id, pid: body.pid });
          return new Response("ok");
        }
        assert.equal(path, "/admit");
        admissions.push({ id: body.id, pid: body.pid, held: body.hold });
        if (body.hold && !released) await held;
        return new Response("ok");
      })().catch((error) => {
        barrierFailures.push(error);
        return new Response("barrier failed", { status: 500 });
      });
      requestTasks.add(task);
      void task.then(() => requestTasks.delete(task));
      return task;
    },
  });
  assert.ok(barrier.port);
  env.OUTBOX_ACCEPTANCE_BARRIER = `http://127.0.0.1:${barrier.port}`;
  await writeFile(
    join(fixture.app, ".env"),
    (await readFile(join(fixture.app, ".env.example"), "utf8")).replace(
      /^MIGRATION_DATABASE_URL=.*$/gm,
      "MIGRATION_DATABASE_URL=",
    ),
  );
  await writeFile(join(fixture.app, "src/outbox/registry.ts"), registry);
  await writeFile(join(fixture.app, "src/outbox-publisher.contract.ts"), typeContract);
  await writeFile(join(fixture.app, "src/outbox-data.ts"), data);
  await command(["run", "check"]);
  await command(["run", "db:migrate", "--seed"], {
    DATABASE_URL: fixture.migrationUrl,
    APP_DATABASE_URL: fixture.migrationUrl,
    MIGRATION_DATABASE_URL: fixture.migrationUrl,
  });
  await command(["src/outbox-data.ts", "publish", firstId]);
  const pending = await observe();
  assert.equal(delivery(pending, firstId).status, "pending");
  assert.equal(domain(pending, firstId, "producer").length, 1);
  assert.equal(domain(pending, firstId, "effect").length, 0);
  await startWorker();
  const normal = await completed(firstId, 15000);
  assert.equal(
    domain(normal, firstId, "effect").length,
    1,
    "Completed delivery must have exactly one committed effect Note.",
  );
  assert.equal(delivery(normal, firstId).attempts, 1);
  assert.equal(admissions.filter((item) => item.id === firstId).length, 1);
  await command(["src/outbox-data.ts", "publish", secondId]);
  const admissionDeadline = Date.now() + 15000;
  while (!admissions.some((item) => item.id === secondId) && Date.now() < admissionDeadline) {
    check();
    assert.equal(worker?.terminal, undefined);
    await Bun.sleep(50);
  }
  assert.equal(
    admissions.filter((item) => item.id === secondId).length,
    1,
    "Second real listener must be admitted before SIGTERM.",
  );
  assert.ok(worker);
  const admittedWorker = worker;
  await signalWorker(admittedWorker);
  const cancellationDeadline = Date.now() + 10000;
  while (!aborts.some((item) => item.id === secondId) && Date.now() < cancellationDeadline) {
    check();
    assert.equal(admittedWorker.terminal, undefined);
    await Bun.sleep(25);
  }
  assert.equal(
    aborts.filter((item) => item.id === secondId).length,
    1,
    "Actual listener must observe its cancellation while held.",
  );
  assert.equal(released, false);
  assert.equal(
    admittedWorker.terminal,
    undefined,
    "Official worker must not exit under its admitted listener.",
  );
  assert.ok(requestTasks.size > 0, "The parent still owns the held admission request.");
  release();
  await stopWorker(admittedWorker);
  worker = undefined;
  const rolledBack = await observe(),
    processing = delivery(rolledBack, secondId);
  assert.equal(domain(rolledBack, secondId, "producer").length, 1);
  assert.equal(
    domain(rolledBack, secondId, "effect").length,
    0,
    "The cancelled listener's uncommitted effect must roll back.",
  );
  assert.equal(processing.status, "processing");
  assert.equal(processing.attempts, 1);
  assert.ok(processing.leaseToken);
  assert.equal(processing.completedAt, null);
  assert.ok(processing.leaseUntil && processing.leaseUntil > rolledBack.nowMs);
  assert.ok(
    processing.leaseUntil - processing.createdAt >= 60000,
    "Use the actual default 60-second lease, with no row acceleration.",
  );
  const leaseUntil = processing.leaseUntil;
  const recoveringWorker = await startWorker();
  const recoveryDeadline = Date.now() + 90000;
  let recovered: Snapshot | undefined,
    observedExpiry = false;
  while (Date.now() < recoveryDeadline) {
    check();
    assert.equal(recoveringWorker.terminal, undefined);
    const snapshot = await observe(),
      state = delivery(snapshot, secondId);
    if (snapshot.nowMs < leaseUntil) {
      assert.equal(state.status, "processing");
      assert.equal(state.attempts, 1);
    } else observedExpiry = true;
    if (state.status === "completed") {
      recovered = snapshot;
      break;
    }
    await Bun.sleep(500);
  }
  assert.ok(
    recovered,
    "Restarted official worker must reclaim after the actual database lease deadline.",
  );
  assert.equal(observedExpiry, true);
  assert.equal(delivery(recovered, secondId).attempts, 2);
  assert.equal(domain(recovered, secondId, "effect").length, 1);
  assert.equal(admissions.filter((item) => item.id === secondId).length, 2);
  assert.equal(aborts.length, 1);
  await stopWorker(recoveringWorker);
  worker = undefined;
  const beforeIdle = await observe(),
    admissionsBefore = admissions.length;
  const idleWorker = await startWorker();
  const idleUntil = Date.now() + 1600;
  while (Date.now() < idleUntil) {
    check();
    assert.equal(idleWorker.terminal, undefined);
    await Bun.sleep(100);
  }
  await stopWorker(idleWorker);
  worker = undefined;
  const afterIdle = await observe();
  assert.deepEqual(
    afterIdle.deliveries,
    beforeIdle.deliveries,
    "Idle restart must preserve completed deliveries and attempt counts.",
  );
  assert.deepEqual(
    afterIdle.notes,
    beforeIdle.notes,
    "Idle restart must preserve exact committed domain rows.",
  );
  assert.equal(admissions.length, admissionsBefore);
  assert.equal(aborts.length, 1);
  console.log(
    JSON.stringify({
      installedOutbox: {
        firstId,
        secondId,
        leaseUntil,
        observedExpiry,
        admissions: admissions.map((item) => ({ id: item.id, held: item.held })),
        attempts: afterIdle.deliveries.map((row) => ({ id: row.id, attempts: row.attempts })),
        domainRows: afterIdle.notes.length,
      },
    }),
  );
  check();
} catch (error) {
  failures.push(error);
} finally {
  release();
  for (const owner of workers)
    try {
      await stopWorker(owner);
    } catch (error) {
      failures.push(error);
    }
  try {
    const notifications = await deadline(
      Promise.allSettled([...requestTasks]),
      10000,
      "Listener notifications did not join.",
    );
    for (const result of notifications)
      if (result.status === "rejected") failures.push(result.reason);
  } catch (error) {
    failures.push(error);
    fixtureSafe = false;
  }
  if (barrier) {
    try {
      assert.equal(
        barrier.pendingRequests,
        0,
        "Listener notification requests must join before barrier removal.",
      );
    } catch (error) {
      failures.push(error);
      fixtureSafe = false;
    }
    try {
      await barrier.stop(true);
    } catch (error) {
      failures.push(error);
      fixtureSafe = false;
    }
  }
  failures.push(...barrierFailures);
  if (activeCommands.size) {
    for (const child of activeCommands)
      try {
        child.kill("SIGTERM");
      } catch (error) {
        failures.push(error);
      }
    fixtureSafe = false;
    failures.push(new Error("Short commands remain unresolved; fixture retained."));
  }
  if (fixtureSafe)
    try {
      await fixture.close();
    } catch (error) {
      failures.push(error);
    }
  else
    failures.push(
      new Error(
        `Installed outbox fixture retained because child termination is unconfirmed: ${fixture.app}`,
      ),
    );
  if (terminationTimer) clearTimeout(terminationTimer);
  if (interrupted) failures.push(interruption);
  process.removeListener("SIGTERM", terminate);
}
throwFailures(failures, "Installed outbox verification and cleanup failed.");
console.log(
  "PASS installed PostgreSQL/RLS outbox: real public publication, committed normal delivery, admitted SIGTERM rollback, default-lease recovery and idle invariance.",
);
