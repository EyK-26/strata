import assert from "node:assert/strict";
import { readdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";

const fixture = await createGeneratedSecurityApp("sqlite", [
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
const env = {
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
  CSRF_TARGET_ORIGIN: undefined,
};
async function run(args: string[], expected = 0) {
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
  assert.equal(exit, expected, `${args.join(" ")}\n${stdout}\n${stderr}`);
  return stdout + stderr;
}
try {
  const cli = join(fixture.app, "node_modules/.bin/strata");
  const before = await Promise.all(
    ["src/routes.ts", "src/cli/register.ts"].map(
      async (path) => [path, await readFile(join(fixture.app, path), "utf8")] as const,
    ),
  );
  const migrations = await readdir(join(fixture.app, "src/db/migrations"));
  assert.match(await run([cli, "help"]), /make:view/);
  await run([cli, "make:view", "reports/Summary"]);
  await run([cli, "make:view", "partials/_card.eta"]);
  await run([cli, "make:view", "errors/404"]);
  const template = join(fixture.app, "views/reports/summary.eta");
  const source = await readFile(template, "utf8");
  assert.match(await run([cli, "make:view", "reports/summary.eta"], 1), /already exists/);
  assert.match(await run([cli, "make:view", "../escape"], 1), /relative name/);
  assert.match(await run([cli, "make:view", "safe", "--force"], 1), /option/);
  assert.equal(await readFile(template, "utf8"), source);
  for (const [path, bytes] of before)
    assert.equal(await readFile(join(fixture.app, path), "utf8"), bytes);
  assert.deepEqual(await readdir(join(fixture.app, "src/db/migrations")), migrations);
  await writeFile(
    join(fixture.app, "view-contract.ts"),
    `import assert from "node:assert/strict";
import { join } from "node:path";
import { EtaViewEngine } from "@getstrata/core/view";
const engine = new EtaViewEngine(join(process.cwd(), "views"));
const html = await engine.render("reports/summary", { title: "Příliš žluťoučký", message: "<script>alert(1)</script>" }, { layout: false });
assert.ok(html.includes("Příliš žluťoučký"));
assert.ok(html.includes("&lt;script&gt;"));
assert.ok(!html.includes("<script>"));
for (const template of ["partials/_card", "errors/404"]) assert.ok((await engine.render(template, {}, { layout: false })).includes("<section>"));
console.log(JSON.stringify({ installedView: true, escaped: true, accented: true }));
`,
  );
  assert.match(await run(["view-contract.ts"]), /"installedView":true/);
  await run(["run", "check"]);
  const views = join(fixture.app, "views"),
    kept = join(fixture.app, "views-kept");
  await rename(views, kept);
  try {
    await symlink(kept, views);
    assert.match(await run([cli, "make:view", "refused"], 1), /symbolic link/);
    assert.equal(await Bun.file(join(kept, "refused.eta")).exists(), false);
  } finally {
    await rm(views);
    await rename(kept, views);
  }
  console.log(
    JSON.stringify({
      installedViewGenerator: true,
      etaRendered: true,
      escaped: true,
      noImplicitRoutesOrMigrations: true,
    }),
  );
} finally {
  await fixture.close();
}
