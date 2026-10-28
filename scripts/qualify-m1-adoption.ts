/** Owned generated-app source/config/lock/data/session rollback rehearsal. Not an app migration. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";
import { candidatePackage } from "./candidate-packages";

const output = process.argv[2];
assert.ok(output);
const root: string = output;
await mkdir(root);
const fixture = await createGeneratedSecurityApp(
  "sqlite",
  [
    "--frontend=server-htmx",
    "--auth=cookie",
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
  { publishedVersion: "2.2.59", parentDirectory: root },
);
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      ["HOME", "PATH", "TMPDIR", "USER", "SHELL"].includes(key),
    ),
  ),
  DATABASE_URL: fixture.runtimeUrl,
  APP_DATABASE_URL: fixture.runtimeUrl,
  MIGRATION_DATABASE_URL: fixture.migrationUrl,
  APP_ENV: "testing",
  APP_URL: "http://127.0.0.1:3000",
  APP_KEY_PREFIX: "m1_owned_adoption",
  SESSION_SECRET: "owned-session-secret-unchanged-across-adoption-steps",
  AUTH_DEV_HEADERS: "false",
  FRONTEND_MODE: "server-htmx",
  TENANCY_DRIVER: "none",
  CACHE_DRIVER: "array",
  QUEUE_DRIVER: "sync",
  MAIL_DRIVER: "log",
  OTEL_SDK_DISABLED: "true",
  M1_ADOPTION_STATE: join(root, "owned-state.json"),
};
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const steps: unknown[] = [];
async function run(args: string[], label: string) {
  const child = Bun.spawn([process.execPath, "--no-env-file", ...args], {
    cwd: fixture.app,
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 90_000,
  });
  const [out, err, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  await writeFile(join(root, `${label}.log`), out + err, { flag: "wx" });
  assert.equal(exit, 0, `${label}: ${out}\n${err}`);
  return out;
}
try {
  await writeFile(
    join(fixture.app, "src/db/migrations/9999_m1_adoption.ts"),
    `import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema, resolveDatabaseDriver } from "@getstrata/core/database/schema";
export default { name: "9999_m1_adoption", async up(db) { await Schema.run(db, resolveDatabaseDriver(), schema => { schema.create("m1_adoption_items", table => { table.id(); table.string("label"); }); }); }, async down(db) { await Schema.run(db, resolveDatabaseDriver(), schema => { schema.drop("m1_adoption_items"); }); } } satisfies Migration;`,
  );
  await run(
    [join(fixture.app, "node_modules/@getstrata/cli/cli.ts"), "migrate"],
    "01-published-migrate",
  );
  await mkdir(join(fixture.app, "src/qualification"));
  for (const file of ["common.ts", "legacy.ts"])
    await copyFile(
      join(import.meta.dir, "fixtures/m1-adoption", file + ".txt"),
      join(fixture.app, "src/qualification", file === "legacy.ts" ? "entry.ts" : file),
    );
  const before = {
    manifest: await readFile(join(fixture.app, "package.json")),
    lock: await readFile(join(fixture.app, "bun.lock")),
    entry: await readFile(join(fixture.app, "src/qualification/entry.ts")),
  };
  await writeFile(join(root, "before-package.json"), before.manifest);
  await writeFile(join(root, "before-bun.lock"), before.lock);
  await writeFile(join(root, "before-entry.ts"), before.entry);
  await run(["run", "check"], "02-published-types");
  await run(
    ["run", "src/qualification/entry.ts", "baseline"],
    "02-published-populated-form-session",
  );
  const manifest = JSON.parse(before.manifest.toString());
  for (const part of ["core", "bootstrap", "cli"] as const)
    manifest.dependencies[`@getstrata/${part}`] = `file:${await candidatePackage(part, root)}`;
  await writeFile(join(fixture.app, "package.json"), JSON.stringify(manifest, null, 2));
  await run(["install", "--ignore-scripts"], "03-candidate-install");
  await copyFile(
    join(import.meta.dir, "fixtures/m1-adoption/modern.ts.txt"),
    join(fixture.app, "src/qualification/entry.ts"),
  );
  await writeFile(
    join(fixture.app, "m1-adoption-policy.json"),
    JSON.stringify(
      {
        runtimeOwner: "M1-only",
        publicDelivery: "explicit separate artifact origin; guarded downloads remain on app",
        legacyWebMiddleware: "remove prior kernel.wrapWeb because M1 applies document CSRF/flash",
        rollback:
          "restore exact source, package and lock; keep compatible schema/data and retained releases",
      },
      null,
      2,
    ),
  );
  await run(["run", "check"], "04-candidate-types");
  await run(
    ["run", "src/qualification/entry.ts", "candidate"],
    "04-candidate-populated-form-session",
  );
  const afterLock = await readFile(join(fixture.app, "bun.lock"));
  assert.notEqual(digest(afterLock), digest(before.lock));
  await copyFile(join(fixture.app, "src/qualification/entry.ts"), join(root, "candidate-entry.ts"));
  await copyFile(join(fixture.app, "m1-adoption-policy.json"), join(root, "candidate-policy.json"));
  await writeFile(join(root, "candidate-bun.lock"), afterLock);
  await writeFile(join(fixture.app, "package.json"), before.manifest);
  await writeFile(join(fixture.app, "bun.lock"), before.lock);
  await writeFile(join(fixture.app, "src/qualification/entry.ts"), before.entry);
  await run(["install", "--frozen-lockfile", "--ignore-scripts"], "05-exact-lock-rollback");
  assert.equal(digest(await readFile(join(fixture.app, "package.json"))), digest(before.manifest));
  assert.equal(digest(await readFile(join(fixture.app, "bun.lock"))), digest(before.lock));
  assert.equal(
    digest(await readFile(join(fixture.app, "src/qualification/entry.ts"))),
    digest(before.entry),
  );
  await run(
    ["run", "src/qualification/entry.ts", "rollback"],
    "06-published-rollback-populated-form-session",
  );
  for (const stage of ["baseline", "candidate", "rollback"])
    steps.push(JSON.parse(await readFile(join(root, `${stage}-receipt.json`), "utf8")));
  await writeFile(
    join(root, "receipt.json"),
    JSON.stringify(
      {
        status: "OWNED_REPRESENTATIVE_ADOPTION_ROLLBACK_PASSED",
        executed: 3,
        failed: 0,
        skipped: 0,
        steps,
        exactSourceManifestLockRestored: true,
        versions:
          "published 2.2.59 -> unpublished same-version tarball -> exact published 2.2.59 lock",
        runtimeSourceAliases: false,
        packagePatches: false,
        retainedBrowserAssetsEvidence:
          "../browser-linux-owned/{chromium,firefox,webkit}/receipt.json",
        scope:
          "Generated cookie/Eta/SQLite app, populated ORM rows and real generated auth directory/session/CSRF across source and lock adoption. Browser retained-A/B proof is a separate integration fixture; this is not whole-app/provider rollout or arbitrary deployment/extension compatibility.",
      },
      null,
      2,
    ),
  );
} finally {
  // The helper owns this generated app and SQLite file. Keep only sanitized evidence outside it.
  await fixture.close();
  const state = Bun.file(env.M1_ADOPTION_STATE);
  if (await state.exists()) await state.delete();
}
