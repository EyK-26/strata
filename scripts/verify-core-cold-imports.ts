#!/usr/bin/env bun
/** Evaluate supported compiled public imports in fresh consumers before checking identity. */
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
assert.ok(args.length <= 1 && args.every((arg) => arg.startsWith("--package-dir=")));
const packageDirectory = resolve(
  args[0]?.slice("--package-dir=".length) || join(import.meta.dir, "../packages/strata-core"),
);
const manifest = await readFile(join(packageDirectory, "package.json"), "utf8");
assert.equal(JSON.parse(manifest).name, "@getstrata/core");
const root = await mkdtemp(join(tmpdir(), "strata-core-cold-imports-"));
const failures: unknown[] = [];
const scenarios = [
  ["bindings-alone", ["@getstrata/core/database/bindings"]],
  ["bindings-model", ["@getstrata/core/database/bindings", "@getstrata/core/database/model"]],
  ["model-bindings", ["@getstrata/core/database/model", "@getstrata/core/database/bindings"]],
  ["root-first", ["@getstrata/core"]],
  ["errors-first", ["@getstrata/core/errors/http"]],
  ["queue-first", ["@getstrata/core/queue/failedJobRepository"]],
] as const;
try {
  // Copy compiled bytes and manifest ONLY: no repository tsconfig, source files or aliases.
  const consumerModules = join(root, "node_modules");
  const copiedPackage = join(consumerModules, "@getstrata/core");
  await mkdir(copiedPackage, { recursive: true });
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  await writeFile(join(copiedPackage, "package.json"), manifest);
  await cp(join(packageDirectory, "dist"), join(copiedPackage, "dist"), { recursive: true });
  // Resolve existing peer/dependency installations from the selected package's ancestors.
  // Nearest modules win; no installation, source framework links or second core package.
  const linked = new Set<string>();
  for (let directory = packageDirectory; ; directory = dirname(directory)) {
    let entries: string[] = [];
    const modules = join(directory, "node_modules");
    try {
      entries = await readdir(modules);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    for (const name of entries) {
      if (name.startsWith(".") || name === "@getstrata") continue;
      if (name.startsWith("@")) {
        await mkdir(join(consumerModules, name), { recursive: true });
        for (const child of await readdir(join(modules, name))) {
          const identity = `${name}/${child}`;
          if (linked.has(identity)) continue;
          await symlink(join(modules, name, child), join(consumerModules, identity));
          linked.add(identity);
        }
      } else if (!linked.has(name)) {
        await symlink(join(modules, name), join(consumerModules, name));
        linked.add(name);
      }
    }
    if (dirname(directory) === directory) break;
  }
  for (const [name, imports] of scenarios) {
    const file = join(root, `${name}.mjs`);
    await writeFile(
      file,
      `import assert from 'node:assert/strict';
// These are the FIRST framework imports in this fresh process.
for(const specifier of ${JSON.stringify(imports)})await import(specifier);
const [root,base,model,definitions,errors,jobs]=await Promise.all([
 import('@getstrata/core'),import('@getstrata/core/database/baseRepository'),
 import('@getstrata/core/database/model'),import('@getstrata/core/database/definitions'),
 import('@getstrata/core/errors/http'),import('@getstrata/core/queue/failedJobRepository'),
]);
assert.strictEqual(root.BaseRepository,base.BaseRepository);
assert.strictEqual(base.default,base.BaseRepository);
assert.strictEqual(root.Model,model.Model);
assert.strictEqual(model.defineModel,definitions.defineModel);
assert.strictEqual(model.defineRepository,definitions.defineRepository);
assert.ok(jobs.FailedJobRepository.prototype instanceof base.BaseRepository);
const names=['BadRequestError','ConflictError','ForbiddenError','HttpError','InternalServerError','isHttpErrorLike','NotFoundError','PayloadTooLargeError','PreconditionFailedError','toHttpError','UnauthorizedError','UnprocessableEntityError','ValidationError'];
assert.deepEqual(Object.keys(errors).sort(),names.sort(),'The supported leaf export surface must remain exact.');
for(const name of names)assert.strictEqual(root[name],errors[name],name+' must have one public identity.');
const details={owned:'cold-import'};
const constructors=['BadRequestError','ConflictError','ForbiddenError','InternalServerError','NotFoundError','PayloadTooLargeError','PreconditionFailedError','UnauthorizedError','UnprocessableEntityError','ValidationError'];
for(const name of constructors){
 assert.equal(typeof errors[name],'function',name+' must remain a constructor.');
 const value=new errors[name]('owned failure',details);
 assert.ok(value instanceof root.HttpError,name+' must construct the canonical HttpError.');assert.ok(value instanceof root[name],name+' must retain its root constructor identity.');
 assert.strictEqual(value.details,details);assert.strictEqual(errors.toHttpError(value),value);
}
const direct=new errors.HttpError(418,'owned status',details);
assert.equal(direct.status,418);assert.strictEqual(root.toHttpError(direct),direct);
let caught;
try{throw new errors.NotFoundError('owned missing',details);}catch(error){caught=error;}
assert.ok(caught instanceof root.NotFoundError);assert.ok(caught instanceof root.HttpError);
assert.equal(caught.status,404);assert.strictEqual(root.toHttpError(caught),caught);
const {normalizeTenantHostname}=await import('@getstrata/core/tenant/publicTenantHost');
assert.throws(()=>normalizeTenantHostname('user@host'),error=>{
 assert.ok(error instanceof root.ForbiddenError);assert.equal(error.status,403);
 assert.strictEqual(errors.toHttpError(error),error);return true;
});
const {runWithEstablishedAuth,establishedAuthReader}=await import('@getstrata/core/auth/authReader');
const request=new Request('https://cold-import.example.test');
await assert.rejects(()=>runWithEstablishedAuth(request,{user:null,credentialSource:null},()=>establishedAuthReader.requireUser(request)),error=>{
 assert.ok(error instanceof root.UnauthorizedError);assert.equal(error.status,401);
 assert.strictEqual(errors.toHttpError(error),error);return true;
});
console.log('PASS cold public imports '+${JSON.stringify(name)});
`,
    );
    const child = Bun.spawn([process.execPath, file], {
      cwd: root,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) =>
            ["PATH", "HOME", "TMPDIR", "USER", "SHELL"].includes(key),
          ),
        ),
        OTEL_SDK_DISABLED: "true",
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30000,
      killSignal: "SIGKILL",
    });
    const results = await Promise.allSettled([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ] as const);
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    const [terminal, out, err] = results;
    const output = `${out.status === "fulfilled" ? out.value : ""}${err.status === "fulfilled" ? err.value : ""}`;
    if (terminal.status === "fulfilled")
      try {
        assert.equal(terminal.value, 0, `${name}: ${output}`);
        assert.ok(output.includes(`PASS cold public imports ${name}`), output);
      } catch (error) {
        errors.push(error);
      }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, `${name} child observations failed.`);
  }
} catch (error) {
  failures.push(error);
} finally {
  try {
    await rm(root, { recursive: true, force: true });
  } catch (error) {
    failures.push(error);
  }
}
if (failures.length === 1) throw failures[0];
if (failures.length > 1)
  throw new AggregateError(failures, "Cold import verification and cleanup failed.");
console.log(
  `Cold public imports and canonical class identities OK (${scenarios.length} fresh processes; ${packageDirectory}).`,
);
