import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp.ts";

const engineArgument = process.argv.find((arg) => arg.startsWith("--database="))?.slice(11);
const version = process.argv.find((arg) => arg.startsWith("--published="))?.slice(12);
assert.ok(
  engineArgument === "mysql" || engineArgument === "postgres" || engineArgument === "sqlite",
);
const engine = engineArgument;
const outputArgument = process.argv.find((arg) => arg.startsWith("--evidence="))?.slice(11);
assert.ok(outputArgument);
const output = outputArgument;
await mkdir(output);
const source = await readFile(
  join(import.meta.dir, "../tests/unit/database/nestedMorphOwnership.test.ts"),
  "utf8",
);
let consumer = source;
if (engine !== "sqlite") {
  const before =
    '  const database = createSqliteConnection(":memory:");\n  useSqlDialect("sqlite");';
  assert.ok(consumer.includes(before));
  consumer = consumer
    .replace(
      'import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";',
      'import { createNativeFixture } from "./nativeFixture.ts";',
    )
    .replace(
      before,
      "  const { database, runSchema, dialect } = await createNativeFixture();\n  useSqlDialect(dialect);",
    )
    .replace('await Schema.run(connection, "sqlite",', "await runSchema(")
    .replace(
      "  const connection: DatabaseConnection = {",
      "  const connection: DatabaseConnection = {\n    begin: database.begin?.bind(database),",
    )
    .replaceAll("f.database.close();", "await f.database.close();");
  const marker = "  class ArticleOwner";
  assert.ok(consumer.indexOf(marker) > 0 && source.indexOf(marker) > 0);
  assert.equal(
    consumer
      .slice(consumer.indexOf(marker))
      .replaceAll("await f.database.close();", "f.database.close();"),
    source.slice(source.indexOf(marker)),
    "Every model declaration, test and assertion must remain byte-identical.",
  );
}
await writeFile(join(output, "consumer.test.ts"), consumer);
const fixture = await createGeneratedSecurityApp(
  engine,
  [
    "--frontend=api",
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
  ],
  { publishedVersion: version, parentDirectory: process.env.STARTER_JOURNEY_PARENT },
);
let active: ReturnType<typeof Bun.spawn> | undefined;
let closing: Promise<void> | undefined;
function cleanup(): Promise<void> {
  closing ??= (async () => {
    try {
      if (active && active.exitCode === null) {
        const ending = active;
        const timer = setTimeout(() => {
          if (ending.exitCode === null) ending.kill("SIGKILL");
        }, 5000);
        try {
          ending.kill("SIGTERM");
          await ending.exited;
        } finally {
          clearTimeout(timer);
        }
      }
    } finally {
      await fixture.close();
    }
  })();
  return closing;
}
const interrupted = () => {
  void cleanup().finally(() => process.exit(143));
};
process.once("SIGTERM", interrupted);
try {
  await writeFile(join(fixture.app, "consumer.test.ts"), consumer);
  await copyFile(
    join(import.meta.dir, "../tests/fixtures/nestedMorphNativeConnection.ts"),
    join(fixture.app, "nativeFixture.ts"),
  );
  await writeFile(
    join(fixture.app, "proof.ts"),
    `import {writeFileSync} from 'node:fs';const names=['@getstrata/core/database/model','@getstrata/core/database/schema','@getstrata/core/database/baseRepository']; const modules=Object.fromEntries(names.map(n=>[n,import.meta.resolve(n)]));if(Object.values(modules).some(p=>!p.includes('/node_modules/@getstrata/core/dist/'))) throw Error('Source alias');writeFileSync(process.argv[2],JSON.stringify({modules,root:import.meta.dir},null,2)+'\\n');`,
  );
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        ["PATH", "HOME", "TMPDIR", "USER", "SHELL"].includes(key),
      ),
    ),
    QUALIFICATION_DATABASE: engine,
    DATABASE_URL: fixture.runtimeUrl,
    DB_CONNECTION: engine === "postgres" ? "pgsql" : engine,
    APP_DATABASE_URL: fixture.runtimeUrl,
    MIGRATION_DATABASE_URL: fixture.migrationUrl,
  };
  async function run(args: string[], name: string) {
    const p = Bun.spawn([process.execPath, ...args], {
      cwd: fixture.app,
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60000,
      killSignal: "SIGTERM",
    });
    active = p;
    const [out, err, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    active = undefined;
    await writeFile(join(output, `${name}.log`), out + err);
    return code;
  }
  assert.equal(await run(["proof.ts", join(output, "installed-modules.json")], "proof"), 0);
  const exitCode = await run(["test", "./consumer.test.ts"], "tests");
  await writeFile(
    join(output, "execution.json"),
    `${JSON.stringify(
      {
        engine,
        mode: version ? "exact-published" : "candidate-packed",
        version: version ?? null,
        exitCode,
        sourceSha256: createHash("sha256").update(source).digest("hex"),
        consumerSha256: createHash("sha256").update(consumer).digest("hex"),
        allModelDeclarationsAndAssertionsPreserved: true,
      },
      null,
      2,
    )}\n`,
  );
  console.log((await readFile(join(output, "tests.log"), "utf8")).slice(-1700));
  assert.equal(exitCode, 0, "All nested ownership assertions must pass.");
} finally {
  process.off("SIGTERM", interrupted);
  await cleanup();
}
