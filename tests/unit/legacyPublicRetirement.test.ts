import { expect, test } from "bun:test";

// Public-only child inputs make this exact test reusable in an archive-installed fixture.
async function observe(binary: string, code: string) {
  const cwd = process.cwd();
  const env = { ...process.env };
  const child = Bun.spawn([binary, "--eval", code], {
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const failures: unknown[] = [];
  const timer = setTimeout(() => {
    try {
      child.kill();
    } catch (error) {
      failures.push(error);
    }
  }, 10000);
  const observation = Promise.allSettled([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ] as const);
  let results: Awaited<typeof observation>;
  try {
    results = await observation;
  } finally {
    clearTimeout(timer);
  }
  for (const result of results) if (result.status === "rejected") failures.push(result.reason);
  if (failures.length) throw new AggregateError(failures, "Public API child observation failed");
  const [terminal, output, diagnostic] = results;
  return {
    exit: terminal.status === "fulfilled" ? terminal.value : undefined,
    stdout: output.status === "fulfilled" ? output.value : undefined,
    stderr: diagnostic.status === "fulfilled" ? diagnostic.value : undefined,
  };
}

test("cold public root/events retain caller-owned identity without eager global or retired exports", async () => {
  const result = await observe(
    process.execPath,
    `
 const assert=await import('node:assert/strict');
 const key=Symbol.for('@getstrata/eventBus');assert.equal(Object.hasOwn(globalThis,key),false);
 const core=await import('@getstrata/core');const events=await import('@getstrata/core/events');
 assert.equal(Object.hasOwn(globalThis,key),false);
 for(const name of ['afterCommit','runInTransaction','requestTransactionRollback','hasActiveTransaction','isActiveTransactionConnection','eventBus','readSharedEventBus','dispatchModelEvent','runWithDeferredModelEvents','onDeferredModelRollback'])assert.equal(name in core,false,name);
 for(const name of ['eventBus','readSharedEventBus','dispatchModelEvent','runWithDeferredModelEvents','afterCommit','onDeferredModelRollback'])assert.equal(name in events,false,name);
 assert.equal(core.EventBus,events.EventBus);assert.equal(core.modelEventName,events.modelEventName);
 assert.equal(typeof core.createDatabaseBindings,'function');const runtime=await import('@getstrata/core/runtime/application');assert.equal(typeof runtime.createApplication,'function');assert.equal(typeof core.createTransactionAcquisitionMetrics,'function');
 for(const name of ['bindDatabaseConnection','getBoundDatabaseConnection','resetBoundDatabaseConnection','registerDefaultDatabasePool','getDefaultDatabasePool','getDefaultDatabaseQuery','isDefaultDatabaseConnection','resetDefaultDatabasePoolForTests','bindBunSql','getNamedConnection','hasNamedConnection','registerNamedConnection','resetNamedConnections','runOnNamedConnection','unregisterNamedConnection','repositoryConnection','resolveRepositoryConnection'])assert.equal(name in core,false,name);
 for(const key of ['@getstrata/defaultDatabaseConnection','@getstrata/boundDatabaseConnection','@getstrata/namedConnections'])assert.equal(Object.hasOwn(globalThis,Symbol.for(key)),false,key);
 for(const name of ['auth','cache','config','events','log','mail','policyGate','queue','storage','setActiveApplicationContext','clearActiveApplicationContext','resolveApplicationAuth','resolveApplicationCache','resolveApplicationConfig','resolveApplicationDependencies','resolveApplicationEventBus','resolveApplicationLogger','resolveApplicationPolicyGate','resolveApplicationQueue'])assert.equal(name in core,false,name);
 assert.equal(Object.hasOwn(globalThis,Symbol.for('@getstrata/applicationContext')),false);
 const native=await import('@getstrata/core/database/bunSql');assert.equal(core.createBunSqlPool,native.createBunSqlPool);assert.equal(typeof core.createDatabaseQueryProxy,'function');assert.equal('bindBunSql' in native,false);
 const bus=new events.EventBus();const other=new core.EventBus();let calls=0;
 const name=events.modelEventName('orders','created');assert.equal(name,'orders.created');
 bus.listen(name,async()=>{await Promise.resolve();calls++;});await other.dispatch(name,{});assert.equal(calls,0);await bus.dispatch(name,{});assert.equal(calls,1);
 assert.equal(Object.hasOwn(globalThis,key),false);console.log('legacy-public-cold-ok');
 `,
  );
  expect(result.exit, result.stderr).toBe(0);
  expect(result.stdout).toContain("legacy-public-cold-ok");
}, 15000);

test("actual Node resolves installed package entries and refuses the retired transaction subpath", async () => {
  const node = Bun.which("node");
  if (!node) throw new Error("Node is required for actual package export-map resolution proof");
  const result = await observe(
    node,
    `
 const assert=require('node:assert/strict');const {createRequire}=require('node:module');
 const fromApp=createRequire(process.cwd()+'/package.json');
 for(const name of ['@getstrata/core','@getstrata/core/events'])assert.equal(typeof fromApp.resolve(name),'string');
 assert.throws(()=>fromApp.resolve('@getstrata/core/database/transaction'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
 for(const path of ['bindConnection','boundConnection','defaultConnection','namedConnections','repositoryConnection'])assert.throws(()=>fromApp.resolve('@getstrata/core/database/'+path),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
 for(const path of ['@getstrata/core/facades','@getstrata/core/runtime/applicationRegistry','@getstrata/bootstrap/applicationRegistry'])assert.throws(()=>fromApp.resolve(path),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
 assert.equal(typeof fromApp.resolve('@getstrata/core/database/bunSql'),'string');
 console.log('legacy-public-node-resolution-ok');
 `,
  );
  expect(result.exit, result.stderr).toBe(0);
  expect(result.stdout).toContain("legacy-public-node-resolution-ok");
}, 15000);
