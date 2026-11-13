import { test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { candidatePackage } from "../../scripts/candidate-packages";

async function run(command: string[], cwd: string, timeout = 30000) {
  const child = Bun.spawn(command, {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
    timeout,
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(
    exit,
    0,
    `${basename(command[0] ?? "command")} failed (${exit})\n${stdout}\n${stderr}`,
  );
  return stdout;
}
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("installed bound persistence shares canonical native classes and executes isolated command and HTTP composition", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strata-bound-consumer-"));
  const root = join(import.meta.dir, "../..");
  const dependencies: Record<string, string> = {};
  const archives: Record<string, { path: string; sha256: string }> = {};
  try {
    for (const part of ["core", "bootstrap"] as const) {
      const path = await candidatePackage(part, directory);
      dependencies[`@getstrata/${part}`] = `file:${path}`;
      archives[part] = { path, sha256: sha(await readFile(path)) };
    }
    for (const name of ["eta", "mysql2", "@node-saml/node-saml", "typescript", "@types/bun"]) {
      const manifest = JSON.parse(
        await readFile(join(root, "node_modules", name, "package.json"), "utf8"),
      );
      dependencies[name] = manifest.version;
    }
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ private: true, type: "module", dependencies }),
    );
    await run([process.execPath, "install", "--ignore-scripts"], directory, 120000);
    for (const part of ["core", "bootstrap"]) {
      const path = join(directory, "node_modules/@getstrata", part);
      assert.equal(
        await realpath(path),
        path,
        "The consumer must install real archives instead of workspace symlinks",
      );
    }
    await copyFile(
      join(root, "tests/fixtures/boundPersistenceConsumer.ts"),
      join(directory, "consumer.ts"),
    );
    // Deliberately compiled only with an external consumer package scope. The
    // workspace owns these private aliases; a dependency consumer must not.
    await writeFile(
      join(directory, "private.contract.ts"),
      `import * as Models from "@getstrata/core/database/model";
import * as Queries from "@getstrata/core/database/repositoryQuery";
export function excludedPrivateAuthority() {
  // @ts-expect-error Public model subpath excludes private construction authority.
  Models.createBoundModel;
  // @ts-expect-error Model snapshots are internal owned query authority.
  Models.snapshotModelQuery;
  // @ts-expect-error Repository snapshots are internal owned query authority.
  Queries.snapshotRepositoryQuery;
  // @ts-expect-error ModelQuery implementation is not an exported package subpath.
  void import("@getstrata/core/database/modelQuery");
  // @ts-expect-error A consumer cannot resolve its dependency's private port alias.
  void import("#strata-orm-internal");
  // @ts-expect-error A consumer cannot resolve its dependency's native ORM alias.
  void import("#strata-orm-runtime");
}
`,
    );
    await writeFile(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ESNext",
          module: "Preserve",
          moduleResolution: "bundler",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: ["bun"],
          allowImportingTsExtensions: true,
        },
        include: ["consumer.ts", "private.contract.ts"],
      }),
    );
    const inputs = {
      archives: Object.fromEntries(
        Object.entries(archives).map(([key, value]) => [key, value.sha256]),
      ),
      consumerSha256: sha(await readFile(join(directory, "consumer.ts"))),
      privateContractsSha256: sha(await readFile(join(directory, "private.contract.ts"))),
      consumerLockSha256: sha(await readFile(join(directory, "bun.lock"))),
      compiler: dependencies.typescript,
    };
    const preserve = process.env.M3B2_PACKED_EVIDENCE_DIR;
    if (preserve) {
      await mkdir(preserve, { recursive: false });
      for (const value of Object.values(archives))
        await copyFile(value.path, join(preserve, basename(value.path)));
      for (const name of [
        "consumer.ts",
        "private.contract.ts",
        "bun.lock",
        "package.json",
        "tsconfig.json",
      ])
        await copyFile(join(directory, name), join(preserve, name));
      await writeFile(join(preserve, "inputs.json"), `${JSON.stringify(inputs, null, 2)}\n`);
    }
    await run(
      [join(directory, "node_modules/.bin/tsc"), "--noEmit", "-p", "tsconfig.json"],
      directory,
    );
    const output = await run([process.execPath, "consumer.ts"], directory);
    const line = output.trim().split("\n").at(-1);
    assert.ok(line);
    const report = JSON.parse(line);
    for (const key of [
      "canonicalClasses",
      "privateArtifactsHidden",
      "privateStateBind",
      "definitionIsolation",
      "actualCommandAndHttp",
      "overlappingHttpAndAppSecrets",
    ])
      assert.equal(report[key], true);
    assert.equal(report.paths.length, 6);
    for (const path of report.paths)
      assert.ok(
        (path.startsWith("file:") ? fileURLToPath(path) : path).startsWith(
          `${directory}/node_modules/@getstrata/`,
        ),
      );
    const receipt = { ...inputs, report };
    if (preserve)
      await writeFile(join(preserve, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, {
        flag: "wx",
      });
    console.log(JSON.stringify(receipt));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 180000);
