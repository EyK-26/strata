/** Native three-engine consumer proof; no runtime SQL, adapter replacement or package patch. */
import assert from "node:assert/strict";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";

const database = process.argv.find((arg) => arg.startsWith("--database="))?.slice(11);
assert.ok(database === "sqlite" || database === "mysql" || database === "postgres");
const publishedVersion = process.argv.find((arg) => arg.startsWith("--published="))?.slice(12);
const phaseAdmission = process.argv.includes("--provider-phase-admission");
const modelWriteHooks = process.argv.includes("--model-write-hooks");
const nativeRouteContracts = process.argv.includes("--native-route-contracts");
const modelAttributeContracts = process.argv.includes("--model-attribute-contracts");
const modelRegistryContracts = process.argv.includes("--model-registry-contracts");
const modelQueryContracts = process.argv.includes("--model-query-contracts");
const relationQueryContracts = process.argv.includes("--relation-query-contracts");
const auditExportContracts = process.argv.includes("--audit-export-contracts");
const routeCollisionContracts = process.argv.includes("--route-collision-contracts");
if (auditExportContracts)
  assert.equal(database, "postgres", "Audit RLS qualification requires Postgres.");
const fixture = await createGeneratedSecurityApp(
  database,
  [
    "--frontend=api",
    "--auth=headers",
    auditExportContracts ? "--tenancy=rls" : "--tenancy=none",
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
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      ["PATH", "HOME", "TMPDIR", "USER", "SHELL"].includes(key),
    ),
  ),
  DATABASE_URL: fixture.runtimeUrl,
  APP_DATABASE_URL: fixture.runtimeUrl,
  DB_CONNECTION: database === "postgres" ? "pgsql" : database,
  APP_ENV: "local",
  APP_URL: "http://127.0.0.1:3000",
  AUTH_DEV_HEADERS: "true",
  TENANCY_DRIVER: auditExportContracts ? "rls" : "none",
  CACHE_DRIVER: "array",
  QUEUE_DRIVER: "sync",
  MAIL_DRIVER: "log",
  OTEL_SDK_DISABLED: "true",
  STRATA_QUALIFY_MODEL_WRITE_HOOKS: String(modelWriteHooks),
};
let child: ReturnType<typeof Bun.spawn> | undefined;
let closing: Promise<void> | undefined;
function cleanup(): Promise<void> {
  closing ??= (async () => {
    try {
      if (child && child.exitCode === null) {
        const ending = child;
        const deadline = setTimeout(() => {
          if (ending.exitCode === null) ending.kill("SIGKILL");
        }, 5000);
        try {
          ending.kill("SIGTERM");
          await ending.exited;
        } finally {
          clearTimeout(deadline);
        }
      }
    } finally {
      await fixture.close();
    }
  })();
  return closing;
}
const terminate = () => {
  void cleanup().finally(() => process.exit(143));
};
process.once("SIGTERM", terminate);

async function run(args: string[], overrides: Record<string, string> = {}) {
  const operation = Bun.spawn([process.execPath, ...args], {
    cwd: fixture.app,
    env: { ...env, ...overrides },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60000,
    killSignal: "SIGTERM",
  });
  child = operation;
  const [code, out, err] = await Promise.all([
    operation.exited,
    new Response(operation.stdout).text(),
    new Response(operation.stderr).text(),
  ]);
  assert.equal(code, 0, `Installed consumer command failed (${args.join(" ")}):\n${out}${err}`);
  return out;
}
try {
  // Application schema belongs to an explicit migration, never the runtime client.
  await writeFile(
    join(fixture.app, "src/db/migrations/9999_rebinding_items.ts"),
    `import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema, resolveDatabaseDriver } from "@getstrata/core/database/schema";
const migration: Migration = {
  name: "9999_rebinding_items",
  async up(db) { await Schema.run(db, resolveDatabaseDriver(), schema => { schema.create("rebinding_items", table => { table.id(); table.string("scope"); table.string("label"); }); }); },
  async down(db) { await Schema.run(db, resolveDatabaseDriver(), schema => { schema.drop("rebinding_items"); }); },
};
export default migration;
`,
  );
  if (relationQueryContracts) {
    await writeFile(
      join(fixture.app, "src/db/migrations/9998_relation_queries.ts"),
      `import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema, resolveDatabaseDriver } from "@getstrata/core/database/schema";
const migration: Migration = {
  name: "9998_relation_queries",
  async up(db) { await Schema.run(db, resolveDatabaseDriver(), schema => {
    schema.create("relation_bridges", table => { table.id(); table.integer("parent_id"); });
    schema.create("relation_far", table => { table.id(); table.integer("bridge_id"); table.integer("tenant_id"); table.string("name"); table.softDeletes(); });
    schema.create("relation_pivot", table => { table.id(); table.integer("parent_id"); table.integer("far_id"); });
  }); },
  async down(db) { await Schema.run(db, resolveDatabaseDriver(), schema => {
    schema.drop("relation_pivot"); schema.drop("relation_far"); schema.drop("relation_bridges");
  }); },
};
export default migration;
`,
    );
  }
  if (auditExportContracts) {
    await writeFile(
      join(fixture.app, "src/db/migrations/9998_audit_export.ts"),
      `import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema, resolveDatabaseDriver } from "@getstrata/core/database/schema";
const migration: Migration = {
  name: "9998_audit_export",
  async up(db) { await Schema.run(db, resolveDatabaseDriver(), schema => {
    schema.create("audit_log", table => {
      table.id(); table.integer("user_id").nullable(); table.string("action"); table.string("subject_type");
      table.integer("subject_id").nullable(); table.json("payload"); table.string("ip_address").nullable();
      table.string("user_agent").nullable(); table.string("checksum").nullable(); table.integer("tenant_id").nullable();
      table.string("trace_id").nullable(); table.timestamp("created_at"); table.timestamp("exported_at").nullable();
    });
  }); },
  async down(db) { await Schema.run(db, resolveDatabaseDriver(), schema => { schema.drop("audit_log"); }); },
};
export default migration;
`,
    );
  }
  await run([join(fixture.app, "node_modules/@getstrata/cli/cli.ts"), "migrate"], {
    MIGRATION_DATABASE_URL: fixture.migrationUrl,
    DATABASE_URL: fixture.migrationUrl,
    APP_DATABASE_URL: fixture.migrationUrl,
  });
  const consumer = join(fixture.app, "src/qualification/repositoryRebinding.ts");
  await mkdir(join(fixture.app, "src/qualification"));
  await copyFile(
    join(import.meta.dir, "../tests/fixtures/repositoryRebindingConsumer.ts"),
    consumer,
  );
  const phaseConsumer = join(fixture.app, "src/qualification/providerPhases.ts");
  if (phaseAdmission) {
    await copyFile(
      join(import.meta.dir, "../tests/fixtures/providerPhaseConsumer.ts"),
      phaseConsumer,
    );
  }
  await copyFile(
    join(import.meta.dir, "../tests/fixtures/modelWriteHookConsumer.ts"),
    join(fixture.app, "src/qualification/modelWriteHookConsumer.ts"),
  );
  const attributeConsumer = join(fixture.app, "src/qualification/modelAttributes.ts");
  const registryConsumer = join(fixture.app, "src/qualification/modelRegistry.ts");
  const queryConsumer = join(fixture.app, "src/qualification/modelQuery.ts");
  const relationConsumer = join(fixture.app, "src/qualification/relationQueries.ts");
  const collisionConsumer = join(fixture.app, "src/qualification/routeCollision.ts");
  if (routeCollisionContracts) {
    await copyFile(
      join(import.meta.dir, "../tests/fixtures/routeCollisionConsumer.ts"),
      collisionConsumer,
    );
  }
  if (relationQueryContracts) {
    await copyFile(
      join(import.meta.dir, "../tests/fixtures/relationQueryConsumer.ts"),
      relationConsumer,
    );
  }
  const auditConsumer = join(fixture.app, "src/qualification/auditExport.ts");
  if (auditExportContracts) {
    await copyFile(
      join(import.meta.dir, "../tests/fixtures/auditExportConsumer.ts"),
      auditConsumer,
    );
  }
  if (modelQueryContracts) {
    await copyFile(join(import.meta.dir, "../tests/fixtures/modelQueryConsumer.ts"), queryConsumer);
  }
  if (modelRegistryContracts) {
    await copyFile(
      join(import.meta.dir, "../tests/fixtures/modelRegistryConsumer.ts"),
      registryConsumer,
    );
  }
  if (modelAttributeContracts) {
    await copyFile(
      join(import.meta.dir, "../tests/fixtures/modelAttributeConsumer.ts"),
      attributeConsumer,
    );
  }
  const nativeConsumer = join(fixture.app, "src/qualification/nativeRoutes.ts");
  if (nativeRouteContracts) {
    await copyFile(
      join(import.meta.dir, "../tests/fixtures/nativeRouteConsumer.ts"),
      nativeConsumer,
    );
  }
  await run(["run", "check"]);
  console.log((await run([consumer])).trim());
  if (phaseAdmission) console.log((await run([phaseConsumer])).trim());
  if (nativeRouteContracts) console.log((await run([nativeConsumer])).trim());
  if (modelAttributeContracts) console.log((await run([attributeConsumer])).trim());
  if (modelRegistryContracts) console.log((await run([registryConsumer])).trim());
  if (modelQueryContracts) console.log((await run([queryConsumer])).trim());
  if (relationQueryContracts) console.log((await run([relationConsumer])).trim());
  if (routeCollisionContracts) console.log((await run([collisionConsumer])).trim());
  if (auditExportContracts) console.log((await run([auditConsumer])).trim());
} finally {
  process.off("SIGTERM", terminate);
  await cleanup();
}
