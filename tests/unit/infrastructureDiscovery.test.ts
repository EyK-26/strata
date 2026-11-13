import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { discoverJobs, resetDiscoverJobsForTests } from "@getstrata/bootstrap/discoverJobs";
import { discoverListeners } from "@getstrata/bootstrap/discoverListeners";
import { createModuleDiscovery, ensureModulesLoaded } from "@getstrata/bootstrap/discoverModules";
import { Job } from "@getstrata/core/queue";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";

const roots: string[] = [];
async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "strata-discovery-"));
  roots.push(root);
  for (const [name, source] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source);
  }
  return root;
}
afterEach(async () => {
  resetDiscoverJobsForTests();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const name = () => `test.discovery.${crypto.randomUUID()}`;
const job = (jobName: string) =>
  `export default class Example {static jobName=${JSON.stringify(jobName)}; async handle(){}}`;

test("awaits TLA, scans nested ESM jobs deterministically, excludes orchestration/tests/types and deduplicates re-exports", async () => {
  const first = name(),
    second = name();
  const directory = await fixture({
    "a.mts": `await Bun.sleep(30); ${job(first)}; export {default as alias} from './a.mts';`,
    "nested/b.mjs": job(second),
    "nested/reexport.ts": "export {default} from '../a.mts';",
    "index.ts": "throw new Error('orchestration must not run');",
    "register.js": "throw new Error('orchestration must not run');",
    "helper.ts": "throw new Error('excluded');",
    "nested/ignored.ts": "throw new Error('relative exclusion');",
    "bad.d.ts": "not valid runtime JS",
    "bad.test.ts": "throw new Error('tests must not load');",
    "README.md": "ignore",
  });
  const pending = discoverJobs({ directory, exclude: ["helper.ts", "nested/ignored.ts"] });
  expect(discoverJobs({ directory, exclude: ["nested/ignored.ts", "helper.ts"] })).toBe(pending);
  expect(jobRegistry.names()).not.toContain(first);
  expect(await pending).toEqual([first, second]);
  expect(jobRegistry.create(first)?.constructor.name).toBe("Example");
});

test("malformed jobs and duplicate names fail with locations before publishing any factory", async () => {
  const unique = name();
  const directory = await fixture({ "a.ts": job(unique), "b.ts": "export default 1;" });
  await expect(discoverJobs({ directory })).rejects.toThrow("b.ts:default");
  expect(jobRegistry.names()).not.toContain(unique);
  expect(await discoverJobs({ directory, exclude: ["b.ts"] })).toEqual([unique]);
  const duplicate = name();
  const duplicates = await fixture({ "a.ts": job(duplicate), "b.ts": job(duplicate) });
  await expect(discoverJobs({ directory: duplicates })).rejects.toThrow(
    `Duplicate job "${duplicate}"`,
  );
  expect(jobRegistry.names()).not.toContain(duplicate);
  const helper = await fixture({ "helper.ts": "export const helper = 1;" });
  await expect(discoverJobs({ directory: helper })).rejects.toThrow("No job exports");
});

test("failed imports are retryable and report their path with the original cause", async () => {
  const directory = await fixture({ "broken.ts": "throw new Error('original-import-error');" });
  const failure = await discoverJobs({ directory }).catch((error) => error);
  expect(failure.message).toContain("broken.ts");
  expect(failure.cause.message).toBe("original-import-error");
  await rm(join(directory, "broken.ts"));
  const fresh = name();
  await writeFile(join(directory, "fresh.ts"), job(fresh));
  expect(await discoverJobs({ directory })).toEqual([fresh]);
});

test("manifests preserve DI factories, support normal/arrow-field jobs and validate before registration", async () => {
  const className = name();
  class Declared extends Job {
    static override jobName = className;
    handle = async () => {};
  }
  const factoryName = name();
  const dependency = { marker: "injected" };
  class Injected extends Job {
    constructor(readonly service: typeof dependency) {
      super();
    }
    async handle() {}
  }
  const factory = () => new Injected(dependency);
  const manifest = [Declared, { name: factoryName, create: factory }];
  expect(await discoverJobs({ manifest })).toEqual([className, factoryName]);
  expect((jobRegistry.create(factoryName) as Injected).service).toBe(dependency);
  expect(jobRegistry.create(className)).toBeInstanceOf(Declared);
  expect(await discoverJobs({ manifest })).toEqual([className, factoryName]);
  await expect(discoverJobs({ manifest: [{ name: "", create: factory }] })).rejects.toThrow(
    "manifest[0]",
  );
  const preserved = name();
  jobRegistry.register(preserved, factory);
  expect(
    await discoverJobs({ manifest: [{ name: preserved, create: () => new Declared() }] }),
  ).toEqual([preserved]);
  expect((jobRegistry.create(preserved) as Injected).service).toBe(dependency);
});

test("reset invalidates pending job publication", async () => {
  const unique = name();
  const directory = await fixture({ "pending.ts": `await Bun.sleep(30); ${job(unique)}` });
  const pending = discoverJobs({ directory });
  resetDiscoverJobsForTests();
  await pending;
  expect(jobRegistry.names()).not.toContain(unique);
  expect(await discoverJobs({ directory })).toEqual([unique]);
});

test("listener discovery awaits TLA, copies immutable declarations, and rejects malformed helpers", async () => {
  const directory = await fixture({
    "a.ts": "await Bun.sleep(25); export default {services:[],repositoryEffects:[]};",
    "nested/b.js": "export {default} from '../a.ts';",
    "helper.ts": "export default 123;",
  });
  await expect(discoverListeners({ directory })).rejects.toThrow("helper.ts");
  const listeners = await discoverListeners({ directory, exclude: ["helper.ts"] });
  expect(listeners).toHaveLength(1);
  expect(listeners.map((value) => value.services)).toEqual([[]]);
  expect(
    listeners.every(
      (value) =>
        Object.isFrozen(value) &&
        Object.isFrozen(value.services) &&
        Object.isFrozen(value.repositoryEffects),
    ),
  ).toBe(true);
  const declaration = { services: [], repositoryEffects: [] };
  const manifest = [declaration, declaration];
  const values = await discoverListeners({ manifest });
  expect(values).toEqual([declaration]);
  expect(values[0]).not.toBe(declaration);
  expect(await discoverListeners({ manifest })).toEqual(values);
  await expect(discoverListeners({ manifest: [1] as never })).rejects.toThrow("manifest[0]");
  const legacy = await fixture({
    "cjs.js": "module.exports={default:{services:[],repositoryEffects:[]}};",
  });
  expect(await discoverListeners({ directory: legacy })).toHaveLength(1);
  const registrar = await fixture({ "callback.ts": "export default ()=>{};" });
  await expect(discoverListeners({ directory: registrar })).rejects.toThrow(
    "Invalid listener declarations",
  );
});

test("module loading is stable, validated, supports JS/named re-export entrypoints and excludes folders", async () => {
  const directory = await fixture({
    "b/index.js": "export const module={name:'b',order:5}; export {module as default};",
    "a/index.mts": "await Bun.sleep(20); export default {name:'a',order:5};",
    "excluded/index.ts": "throw new Error('excluded');",
  });
  const discovery = createModuleDiscovery({ modulesDir: directory, exclude: ["excluded"] });
  const pending = discovery.load();
  expect(discovery.load()).toBe(pending);
  expect((await pending).map((value) => value.name)).toEqual(["a", "b"]);
  expect(await discovery.load()).toHaveLength(2);
  const bad = await fixture({ "bad/index.ts": "export default {name:'bad',routes:1};" });
  await expect(ensureModulesLoaded({ modulesDir: bad })).rejects.toThrow("Invalid routes");
  await expect(ensureModulesLoaded({ modulesDir: bad })).rejects.toThrow("Invalid routes");
});

test("module manifests validate identity and lifecycle hooks without running them during discovery", async () => {
  let boots = 0;
  const manifest = [
    {
      name: "declared",
      providers: [
        {
          name: "provider",
          boot: async () => {
            boots++;
          },
        },
      ],
    },
  ];
  expect(await ensureModulesLoaded({ manifest })).toEqual(manifest);
  expect(boots).toBe(0);
  expect(await ensureModulesLoaded({ manifest })).toEqual(manifest);
  await expect(
    ensureModulesLoaded({ manifest: [{ name: "duplicate" }, { name: "duplicate" }] }),
  ).rejects.toThrow("Duplicate module");
  for (const value of [
    1,
    {},
    { name: "ok", order: NaN },
    { name: "ok", providers: 1 },
    { name: "ok", providers: [{ name: "bad", boot: 1 }] },
  ])
    await expect(ensureModulesLoaded({ manifest: [value] as never })).rejects.toThrow("Invalid");
  expect(await ensureModulesLoaded({ modulesDir: await fixture({}) })).toEqual([]);
});

test("interleaved discovery owners retain completed results and pending imports", async () => {
  const directory = await fixture({
    "pending/index.ts": "await Bun.sleep(30); export default {name:'old'};",
  });
  const first = createModuleDiscovery({ modulesDir: directory });
  const second = createModuleDiscovery({ manifest: [{ name: "new" }] });
  const pending = first.load();
  const completed = await second.load();
  expect(completed.map((value) => value.name)).toEqual(["new"]);
  const old = await pending;
  expect(old.map((value) => value.name)).toEqual(["old"]);
  await ensureModulesLoaded({ manifest: [{ name: "third" }] });
  expect(await first.load()).toBe(old);
  expect(await second.load()).toBe(completed);
  expect(completed.map((value) => value.name)).toEqual(["new"]);
  expect(Object.isFrozen(old)).toBe(true);
  expect(Object.isFrozen(completed)).toBe(true);
});

test("missing roots are optional, invalid directories and ambiguous module entrypoints fail", async () => {
  const root = await fixture({
    file: "not a directory",
    "ambiguous/index.ts": "export default {}",
    "ambiguous/index.js": "export default {}",
  });
  expect(await discoverJobs({ directory: join(root, "absent") })).toEqual([]);
  expect(await discoverListeners({ directory: join(root, "absent") })).toEqual([]);
  await expect(discoverListeners({ directory: join(root, "file") })).rejects.toThrow();
  await expect(ensureModulesLoaded({ modulesDir: join(root, "file") })).rejects.toThrow();
  expect(await ensureModulesLoaded({ modulesDir: join(root, "absent") })).toEqual([]);
  await expect(ensureModulesLoaded({ modulesDir: root })).rejects.toThrow(
    "Expected one module entrypoint",
  );
});

test("independent job sources cannot silently replace discovered identities", async () => {
  const shared = name();
  const first = await fixture({ "job.ts": job(shared) });
  const second = await fixture({ "job.ts": job(shared) });
  expect(await discoverJobs({ directory: first })).toEqual([shared]);
  await expect(discoverJobs({ directory: second })).rejects.toThrow("Duplicate discovered job");
});

test("a repaired module directory retries the same source after filesystem failure", async () => {
  const root = await fixture({ modules: "not a directory" });
  const modulesDir = join(root, "modules");
  const discovery = createModuleDiscovery({ modulesDir });
  await expect(discovery.load()).rejects.toThrow();
  await rm(modulesDir);
  await mkdir(join(modulesDir, "valid"), { recursive: true });
  await writeFile(join(modulesDir, "valid/index.ts"), "export default {name:'repaired'};");
  expect((await discovery.load()).map((module) => module.name)).toEqual(["repaired"]);
});

test("bundled explicit manifests load once and prepare listener services once with public bootstrap contracts", async () => {
  const root = await fixture({
    "entry.ts": `
import {discoverJobs} from '@getstrata/bootstrap/discoverJobs';
import {discoverListeners} from '@getstrata/bootstrap/discoverListeners';
import {createModuleDiscovery} from '@getstrata/bootstrap/discoverModules';
import {collectProviders,createAppContext} from '@getstrata/bootstrap/context';
import {jobRegistry} from '@getstrata/core/queue/jobRegistry';
import {service} from '@getstrata/core/contracts/services';
import {createServiceToken} from '@getstrata/core/contracts/token';
import {BaseRepository} from '@getstrata/core/database/baseRepository';
import {defineRepository,repositoryEffects} from '@getstrata/core/database/definitions';
import {createDatabaseBindings} from '@getstrata/core/database/bindings';
let jobs=0,listeners=0,boots=0;
class Example {static jobName='bundled-job'; async handle(){jobs++;}}
const jobManifest=[Example];
const listenerToken=createServiceToken('fixture.listener');
const repository=defineRepository({name:'Fixture',table:{name:'fixture',primaryKey:'id',columns:['id']},dependencies:[],create:binding=>new BaseRepository(binding)});
const listenerManifest=[{services:[service(listenerToken,{lifetime:'application',dependencies:[],async create(){await Bun.sleep(5);listeners++;return async()=>{};}})],repositoryEffects:[repositoryEffects(repository,[{action:'created',afterCommit:listenerToken}])]}];
const discovery=createModuleDiscovery({manifest:[{name:'feature',providers:[{name:'feature.boot',async boot(){boots++;}}]}]});
const [modules,again] = await Promise.all([discovery.load(),discovery.load()]);
await Promise.all([discoverJobs({manifest:jobManifest}),discoverJobs({manifest:jobManifest})]);
const before={boots,listeners};
const providers=collectProviders(modules).filter(provider=>['core.config','core.cache','core.storage','feature.boot'].includes(provider.name));
const declarations=await discoverListeners({manifest:listenerManifest});
const context=await createAppContext(providers,{connection:'main',definition:{providers:[],services:[...declarations.flatMap(value=>value.services),...createDatabaseBindings({default:'main',connections:{main:{driver:'sqlite',filename:':memory:'}},repositories:[repository],repositoryEffects:declarations.flatMap(value=>value.repositoryEffects)})]}});
await jobRegistry.create('bundled-job').handle({});
await context.dispose();
console.log(JSON.stringify({same:modules===again,before,jobs,listeners,boots}));
`,
  });
  await symlink(join(import.meta.dir, "../../node_modules"), join(root, "node_modules"), "dir");
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { module: "Preserve", moduleResolution: "bundler" } }),
  );
  const result = await Bun.build({
    tsconfig: join(root, "tsconfig.json"),
    entrypoints: [join(root, "entry.ts")],
    outdir: join(root, "bundle"),
    target: "bun",
    external: ["@getstrata/core", "@getstrata/core/*"],
  });
  if (!result.success) throw new AggregateError(result.logs, "Manifest bundle failed");
  const child = Bun.spawn(
    [
      process.execPath,
      "--tsconfig-override",
      join(root, "tsconfig.json"),
      join(root, "bundle/entry.js"),
    ],
    {
      cwd: root,
      env: { ...process.env, CACHE_DRIVER: "array", QUEUE_DRIVER: "sync", APP_ENV: "local" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [output, errors, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`Bundled manifests failed: ${errors}`);
  expect(JSON.parse(output.trim())).toEqual({
    same: true,
    before: { boots: 0, listeners: 0 },
    jobs: 1,
    listeners: 1,
    boots: 1,
  });
});
