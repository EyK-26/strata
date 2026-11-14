import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";

const passed: string[] = [];
for (const database of ["sqlite", "postgres", "mysql"] as const) {
  const fixture = await createGeneratedSecurityApp(database, [
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
  ]);
  const env: Record<string, string | undefined> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        ["PATH", "HOME", "TMPDIR", "USER", "SHELL"].includes(key),
      ),
    ),
    APP_ENV: "local",
    DATABASE_URL: fixture.runtimeUrl,
    APP_DATABASE_URL: fixture.runtimeUrl,
    MIGRATION_DATABASE_URL: "",
    SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID(),
    TENANCY_DRIVER: "none",
    AUTH_DRIVER: "headers",
    CACHE_DRIVER: "array",
    QUEUE_DRIVER: "sync",
    MAIL_DRIVER: "log",
    FEATURE_MFA: "false",
    FEATURE_EMAIL_VERIFICATION: "false",
    FEATURE_SCIM: "false",
    FEATURE_METRICS: "false",
    FEATURE_OAUTH: "false",
    FEATURE_SAML: "false",
    FEATURE_BILLING: "false",
    APP_URL: "http://localhost:3000",
    CSRF_TARGET_ORIGIN: undefined,
  };
  const failures: unknown[] = [];
  let activeChild: ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">> | undefined;
  let terminationTimer: ReturnType<typeof setTimeout> | undefined;
  let interrupted = false;
  const interruption = new Error("Installed model verification interrupted by SIGTERM.");
  function throwFailures(errors: unknown[], message: string): void {
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, message);
  }
  function checkInterrupted(): void {
    if (interrupted) throw interruption;
  }
  const terminate = () => {
    interrupted = true;
    process.exitCode = 143;
    if (activeChild?.exitCode === null) {
      try {
        activeChild.kill("SIGTERM");
      } catch (error) {
        failures.push(error);
      }
      terminationTimer ??= setTimeout(() => {
        try {
          if (activeChild?.exitCode === null) activeChild.kill("SIGKILL");
        } catch (error) {
          failures.push(error);
        }
      }, 5000);
    }
  };
  process.once("SIGTERM", terminate);
  async function run(args: string[], expected = 0, migration = false): Promise<string> {
    checkInterrupted();
    const child = Bun.spawn([process.execPath, ...args], {
      cwd: fixture.app,
      env: { ...env, MIGRATION_DATABASE_URL: migration ? fixture.migrationUrl : "" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60000,
      killSignal: "SIGKILL",
    });
    activeChild = child;
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
        (out.status === "fulfilled" ? out.value : "") +
        (err.status === "fulfilled" ? err.value : "");
      if (terminal.status === "fulfilled")
        try {
          assert.equal(terminal.value, expected, `${database}: ${args.join(" ")}\n${output}`);
        } catch (error) {
          errors.push(error);
        }
      if (interrupted) errors.push(interruption);
      throwFailures(errors, "Installed model child exit/output collection failed.");
      return output;
    } finally {
      if (terminationTimer) clearTimeout(terminationTimer);
      terminationTimer = undefined;
      activeChild = undefined;
    }
  }
  const cli = join(fixture.app, "node_modules/.bin/strata");
  try {
    assert.match(await run([cli, "help"]), /make:model/);
    const migrations = join(fixture.app, "src/db/migrations");
    const initialMigrations = await readdir(migrations);
    const registerPath = join(fixture.app, "src/models/register.ts");
    const registerBefore = await readFile(registerPath, "utf8");
    await run([cli, "make:model", "Native/Lead", "--table=native_records", "--key-type=string"]);
    await run([cli, "make:factory", "Native/Lead"]);
    await run([cli, "make:model", "Counter"]);
    assert.deepEqual(await readdir(migrations), initialMigrations);
    assert.equal(await readFile(registerPath, "utf8"), registerBefore);
    const model = join(fixture.app, "src/models/Native/Lead.ts");
    const digest = createHash("sha256")
      .update(await readFile(model))
      .digest("hex");
    assert.match(await run([cli, "make:model", "Native/Lead"], 1), /already exists/);
    assert.equal(
      createHash("sha256")
        .update(await readFile(model))
        .digest("hex"),
      digest,
    );
    assert.match(await run([cli, "make:model", "../Escape"], 1), /relative name/);
    assert.match(await run([cli, "make:model", "Other", "--migration"], 1), /make:migration/);
    assert.match(await run([cli, "make:model", "--help"]), /--primary-key/);
    // Deliberate application-owned domain edits after generation; no schema inference.
    await run([cli, "make:model", "Contact", "--table=workflow_contacts", "--key-type=string"]);
    const contactPath = join(fixture.app, "src/models/Contact.ts");
    const contact = await readFile(contactPath, "utf8");
    let editedContact = contact;
    for (const [before, after] of [
      ["id: string;", "id: string;\n  name: string;"],
      ['columns: ["id"]', 'columns: ["id", "name"]'],
      ['attributes: { fillable: ["id"]', 'attributes: { fillable: ["id", "name"]'],
    ]) {
      assert.ok(before !== undefined && after !== undefined);
      assert.equal(
        editedContact.split(before).length,
        2,
        `Canonical Contact edit must match exactly once: ${before}`,
      );
      editedContact = editedContact.replace(before, after);
    }
    await writeFile(contactPath, editedContact);
    // Factories consume the edited model record; module generation also honors an app-owned path.
    const configPath = join(fixture.app, "strata.config.ts");
    const configBefore = await readFile(configPath, "utf8");
    assert.equal(configBefore.split('modulesDirectory: "./src/modules"').length, 2);
    await writeFile(
      configPath,
      configBefore.replace(
        'modulesDirectory: "./src/modules"',
        'modulesDirectory: "./src/features"',
      ),
    );
    try {
      await run([cli, "make:factory", "Contact"]);
      const contactFactory = await readFile(
        join(fixture.app, "src/db/factories/ContactFactory.ts"),
        "utf8",
      );
      assert.match(contactFactory, /models\/Contact\.ts/);
      await run([cli, "make:model", "Product"]);
      await run([cli, "make:factory", "Product"]);
      const productFactoryPath = join(fixture.app, "src/db/factories/ProductFactory.ts");
      const productFactory = await readFile(productFactoryPath, "utf8");
      assert.match(productFactory, /models\/Product\.ts/);
      await run([cli, "make:module", "Product"]);
      assert.equal(
        await readFile(productFactoryPath, "utf8"),
        productFactory,
        "Module generation preserves the factory made first.",
      );
      assert.ok(await Bun.file(join(fixture.app, "src/features/product/model.ts")).exists());
      const filesBeforeHelp = (await readdir(join(fixture.app, "src"), { recursive: true })).sort();
      for (const command of ["make:factory", "make:module"]) {
        assert.match(await run([cli, command, "Unused", "--help"]), /Usage:/);
        assert.match(await run([cli, command, "../Escape"], 1), /valid relative name/);
      }
      assert.deepEqual(
        (await readdir(join(fixture.app, "src"), { recursive: true })).sort(),
        filesBeforeHelp,
        "Help and invalid names create no scaffold files.",
      );
    } finally {
      await writeFile(configPath, configBefore);
    }
    assert.deepEqual(await readdir(migrations), initialMigrations);
    assert.equal(
      await readFile(registerPath, "utf8"),
      registerBefore,
      "Generation must leave application registration unchanged.",
    );
    // The application explicitly composes the generated definitions after proving generator behavior.
    const repositoryDeclaration = "export const repositoryDefinitions = Object.freeze([";
    const modelDeclaration = "export const modelDefinitions = Object.freeze([";
    assert.equal(registerBefore.split(repositoryDeclaration).length, 2);
    assert.equal(registerBefore.split(modelDeclaration).length, 2);
    await writeFile(
      registerPath,
      `import {NativeLeadDefinition,NativeLeadRepository} from './Native/Lead.ts';\nimport {CounterDefinition,CounterRepository} from './Counter.ts';\nimport {ContactDefinition,ContactRepository} from './Contact.ts';\n` +
        registerBefore
          .replace(
            repositoryDeclaration,
            `${repositoryDeclaration}NativeLeadRepository, CounterRepository, ContactRepository, `,
          )
          .replace(
            modelDeclaration,
            `${modelDeclaration}NativeLeadDefinition, CounterDefinition, ContactDefinition, `,
          ),
    );
    await run([cli, "make:view", "contacts/show"]);
    await run([cli, "make:migration", "create_native_records"]);
    const migrationName = (await readdir(migrations)).find((name) =>
      name.endsWith("_create_native_records.ts"),
    );
    assert.ok(migrationName);
    const driver = database === "postgres" ? "pgsql" : database;
    await writeFile(
      join(migrations, migrationName),
      `import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
const migration: Migration = {
  name: "${migrationName.slice(0, -3)}",
  up: (db) => Schema.run(db, "${driver}", (schema) => {
    schema.create("native_records", (table) => { table.uuid("id").primary(); });
    schema.create("counters", (table) => { table.id(); });
    schema.create("workflow_contacts", (table) => { table.uuid("id").primary(); table.string("name"); });
  }),
  down: (db) => Schema.run(db, "${driver}", (schema) => {
    schema.drop("workflow_contacts"); schema.drop("counters"); schema.drop("native_records");
  }),
};
export default migration;
`,
    );
    await run([cli, "migrate"], 0, true);
    await writeFile(
      join(fixture.app, "model-contract.ts"),
      `import assert from 'node:assert/strict';
import type {Application} from '@getstrata/core/contracts/application';
import {PersistenceError} from '@getstrata/core/database/errors';
import {bootstrapApp} from './src/bootstrap/createApp.ts';
import {NativeLeadDefinition,NativeLeadRepository} from './src/models/Native/Lead.ts';
import {createNativeLeadFactory} from './src/db/factories/Native/LeadFactory.ts';
import {CounterDefinition,CounterRepository} from './src/models/Counter.ts';
import {ContactDefinition} from './src/models/Contact.ts';
import {createContactFactory} from './src/db/factories/ContactFactory.ts';
import {createProductFactory} from './src/db/factories/ProductFactory.ts';
import {ProductDefinition} from './src/features/product/model.ts';
import {EtaViewEngine,htmlResponse} from '@getstrata/core/view';
assert.equal(process.env.MIGRATION_DATABASE_URL??'','');
const envelope={kind:'command' as const,actor:{kind:'system' as const,policy:'fixture.generated-models'}};
function nativeDuplicate(error:unknown):boolean{
 if(error instanceof PersistenceError)return error.code==='DATABASE_UNIQUE_CONSTRAINT'&&nativeDuplicate(error.cause);
 if(error instanceof AggregateError)return error.errors.length>0&&error.errors.every(nativeDuplicate);
 if(error===null||typeof error!=='object')return false;
 const code=Reflect.get(error,'code')${database === "sqlite" ? "" : ",errno=Reflect.get(error,'errno')"};
 return ${database === "sqlite" ? "code==='SQLITE_CONSTRAINT_PRIMARYKEY'||code==='SQLITE_CONSTRAINT_UNIQUE'" : database === "mysql" ? "code==='ER_DUP_ENTRY'&&errno===1062" : "errno==='23505'||code==='23505'"};
}
let owner:Application|undefined;const errors:unknown[]=[];
try{
 const app=await bootstrapApp({migrate:false,mode:'command',onConstructed:application=>{owner=application;return undefined;}});
 const id=crypto.randomUUID();
 // Both generated Product models are compiled, without requesting unregistered definitions.
 assert.equal(ProductDefinition.name,'Product');
 assert.equal(createProductFactory(()=>({id:23})).make().id,23);
 await app.invoke(envelope,async({database})=>{
  const leads=database.model(NativeLeadDefinition);const repository=database.repository(NativeLeadRepository);
  assert.strictEqual(leads,database.model(NativeLeadDefinition));
  assert.strictEqual(repository,database.repository(NativeLeadRepository));
  assert.strictEqual(leads.repository(),repository);
  assert.equal(repository.getTable().name,'native_records');
  const leadFactory=createNativeLeadFactory(()=>({id}),async values=>(await leads.create(values)).toObject());
  assert.equal((await leadFactory.create()).id,id);
  assert.equal((await leads.find(id))?.toObject().id,id);
 });
 // Expected native duplicate failure ends its invocation; unrelated workflow gets a new one.
 await assert.rejects(()=>app.invoke(envelope,({database})=>database.model(NativeLeadDefinition).create({id})),nativeDuplicate);
 await app.invoke(envelope,async({database})=>{
  const counters=database.model(CounterDefinition);const repository=database.repository(CounterRepository);
  assert.strictEqual(counters.repository(),repository);assert.equal(repository.getTable().name,'counters');
  await repository.create({id:17});assert.equal((await counters.find(17))?.toObject().id,17);
  // The id-only repository requires column values; native default insertion proves generated IDs.
  await database.execute({text:${JSON.stringify(database === "mysql" ? "INSERT INTO counters () VALUES ()" : "INSERT INTO counters DEFAULT VALUES")},params:[]});
  const numericRows=await repository.findAll();assert.equal(numericRows.length,2);
  const generated=numericRows.find(row=>row.id!==17);assert.ok(generated);
  assert.ok(Number.isSafeInteger(generated.id)&&generated.id>0);
  const assigned=await counters.find(generated.id);assert.ok(assigned);
  assigned.fill({id:9999});assert.equal(assigned.toObject().id,generated.id);
  assert.equal(await counters.find(9999),null);
  const contacts=database.model(ContactDefinition);
  const contactFactory=createContactFactory(()=>({id:crypto.randomUUID(),name:'Příliš žluťoučký'}),async values=>(await contacts.create(values)).toObject());
  const made=await contactFactory.create();
  const person=await contacts.findOrFail(made.id);
  assert.equal((await contacts.find(person.toObject().id))?.toObject().name,'Příliš žluťoučký');
  await person.update({name:'Updated <contact>'});
  const stored=await contacts.find(person.toObject().id);assert.equal(stored?.toObject().name,'Updated <contact>');
  const html=await new EtaViewEngine('views').render('contacts/show',{title:stored?.toObject().name,message:'Příliš žluťoučký'},{layout:false});
  assert.equal(htmlResponse(html).headers.get('content-type'),'text/html; charset=utf-8');
  assert.ok(html.includes('Updated &lt;contact&gt;'));assert.ok(html.includes('Příliš žluťoučký'));
 });
}catch(error){errors.push(error);}
if(owner)try{const stopped=await owner.stop({reason:'Generated model contract complete'});if(!stopped.successful)throw new Error('Generated model owner did not stop cleanly',{cause:stopped});}catch(error){errors.push(error);}
if(errors.length===1)throw errors[0];if(errors.length>1)throw new AggregateError(errors,'Generated model contract and cleanup failed.');
console.log(JSON.stringify({installedModel:true,explicitRegistration:true,selectedRepository:true,uuidWrite:true,modelFactoryModuleMigrationViewWorkflow:true}));
`,
    );
    assert.match(await run(["model-contract.ts"]), /"explicitRegistration":true/);
    await run(["run", "check"]);
    checkInterrupted();
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      await fixture.close();
    } catch (error) {
      failures.push(error);
    }
    if (interrupted) failures.push(interruption);
    process.removeListener("SIGTERM", terminate);
  }
  throwFailures(failures, "Installed model verification and cleanup failed.");
  passed.push(database);
  console.log(
    `PASS installed CLI/model/factory/module/UUID migration/explicit registration ${database}`,
  );
}
assert.deepEqual(passed, ["sqlite", "postgres", "mysql"]);
console.log(
  JSON.stringify({
    installedModelGenerator: true,
    dialects: passed,
    explicitRepositories: true,
    noImplicitMigration: true,
  }),
);
