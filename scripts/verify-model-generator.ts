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
    ...process.env,
    APP_ENV: "local",
    DATABASE_URL: fixture.runtimeUrl,
    APP_DATABASE_URL: fixture.runtimeUrl,
    MIGRATION_DATABASE_URL: fixture.migrationUrl,
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
  async function run(args: string[], expected = 0): Promise<string> {
    const proc = Bun.spawn([process.execPath, ...args], {
      cwd: fixture.app,
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60000,
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    assert.equal(exit, expected, `${database}: ${args.join(" ")}\n${stdout}\n${stderr}`);
    return stdout + stderr;
  }
  const cli = join(fixture.app, "node_modules/.bin/strata");
  try {
    assert.match(await run([cli, "help"]), /make:model/);
    const migrations = join(fixture.app, "src/db/migrations");
    const initialMigrations = await readdir(migrations);
    const registerPath = join(fixture.app, "src/models/register.ts");
    const registerBefore = await readFile(registerPath, "utf8");
    await run([cli, "make:model", "Native/Lead", "--table=native_records", "--key-type=string"]);
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
    await writeFile(
      contactPath,
      contact
        .replace("id: string;", "id: string;\n  name: string;")
        .replace('columns: ["id"]', 'columns: ["id", "name"]')
        .replace('$fillable = ["id"]', '$fillable = ["id", "name"]'),
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
    await run([cli, "migrate"]);
    await writeFile(
      join(fixture.app, "src/models/DiscoveryProbe.ts"),
      `import { NativeLead } from "./Native/Lead.ts";
export class DiscoveredNativeLead extends NativeLead {
  static override boot(): void { Reflect.set(globalThis, "__nativeDiscoveryBooted", true); }
}
`,
    );
    await writeFile(
      join(fixture.app, "model-contract.ts"),
      `import assert from "node:assert/strict";
Reflect.set(globalThis, "__nativeDiscoveryBooted", false);
const { bootstrapApp } = await import("./src/bootstrap/createApp.ts");
const app = await bootstrapApp({ migrate: false });
const { closeDatabase } = await import("./src/bootstrap/database.ts");
try {
  // The consumer never imports the probe or calls discoverModels/bootModels itself.
  assert.equal(Reflect.get(globalThis, "__nativeDiscoveryBooted"), true);
  const { NativeLead } = await import("./src/models/Native/Lead.ts");
  const { Counter } = await import("./src/models/Counter.ts");
  assert.strictEqual(NativeLead.repository(), NativeLead.repository());
  assert.equal(NativeLead.repository().getTable().name, "native_records");
  const id = crypto.randomUUID();
  assert.equal((await NativeLead.create({ id })).toObject().id, id);
  assert.equal((await NativeLead.find(id))?.toObject().id, id);
  await assert.rejects(NativeLead.create({ id }));
  // Numeric scaffolds do not grant mass assignment to generated IDs by default.
  await Counter.repository().create({ id: 17 });
  assert.equal((await Counter.find(17))?.toObject().id, 17);
  assert.equal(Counter.repository().getTable().name, "counters");
  const { Contact } = await import("./src/models/Contact.ts");
  const { EtaViewEngine, htmlResponse } = await import("@getstrata/core/view");
  const person = await Contact.create({ id: crypto.randomUUID(), name: "Příliš žluťoučký" });
  assert.equal((await Contact.find(person.toObject().id))?.toObject().name, "Příliš žluťoučký");
  await person.update({ name: "Updated <contact>" });
  const stored = await Contact.find(person.toObject().id);
  assert.equal(stored?.toObject().name, "Updated <contact>");
  const html = await new EtaViewEngine("views").render("contacts/show", { title: stored?.toObject().name, message: "Příliš žluťoučký" }, { layout: false });
  const response = htmlResponse(html);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.ok(html.includes("Updated &lt;contact&gt;"));
  assert.ok(html.includes("Příliš žluťoučký"));
  console.log(JSON.stringify({ installedModel: true, discovery: true, automaticRepository: true, uuidWrite: true, modelMigrationViewWorkflow: true }));
} finally { await app.context.dispose(); await closeDatabase(); }
`,
    );
    assert.match(await run(["model-contract.ts"]), /"automaticRepository":true/);
    await run(["run", "check"]);
    passed.push(database);
    console.log(`PASS installed CLI/model/UUID migration/automatic repository ${database}`);
  } finally {
    await fixture.close();
  }
}
assert.deepEqual(passed, ["sqlite", "postgres", "mysql"]);
console.log(
  JSON.stringify({
    installedModelGenerator: true,
    dialects: passed,
    automaticRepositories: true,
    noImplicitMigration: true,
  }),
);
