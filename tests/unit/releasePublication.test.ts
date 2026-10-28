import { describe, expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const packageName = "@getstrata/core";
const version = "2.2.59";

async function publicationFunction(): Promise<string> {
  const workflow = await readFile(join(root, ".github/workflows/release.yml"), "utf8");
  const match = workflow.match(/^ {10}publish_package\(\) \{\n[\s\S]*?^ {10}\}/m);
  if (!match) throw new Error("The release workflow publication function was not found.");
  return match[0].replace(/^ {10}/gm, "");
}

type RegistryCase = { status?: number; body?: unknown; raw?: string; disconnected?: boolean };
type ExecutionCase = { conditional?: boolean; statusOverride?: string; publishExit?: number };

async function runPublication(registry: RegistryCase, execution: ExecutionCase = {}) {
  const fixture = await mkdtemp(join(tmpdir(), "strata-publication-contract-"));
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname !== `/${packageName}`) {
        return new Response("Unexpected fixture request", { status: 400 });
      }
      if (registry.raw !== undefined) return new Response(registry.raw);
      return Response.json(registry.body ?? {}, { status: registry.status ?? 200 });
    },
  });
  const endpoint = `http://127.0.0.1:${server.port}`;
  try {
    await mkdir(join(fixture, "bin"));
    await mkdir(join(fixture, "scripts"));
    await mkdir(join(fixture, "packages/strata-core"), { recursive: true });
    await writeFile(
      join(fixture, "packages/strata-core/package.json"),
      JSON.stringify({ name: packageName, version }),
    );
    // Copy only owned script inputs. Dependencies and production registry settings
    // are not patched; the preload maps the canonical read to our local server.
    for (const script of [
      "package-publication-status.ts",
      "published-package-versions.ts",
      "stable-version.ts",
    ]) {
      const source = join(root, "scripts", script);
      if (await Bun.file(source).exists()) {
        await copyFile(source, join(fixture, "scripts", script));
      }
    }
    await writeFile(
      join(fixture, "registry-preload.ts"),
      `const nativeFetch = globalThis.fetch;
globalThis.fetch = ((input, init) => {
  if (String(input) !== "https://registry.npmjs.org/${packageName}") {
    throw new Error("Unexpected registry request in owned fixture");
  }
  return nativeFetch(${JSON.stringify(`${endpoint}/${packageName}`)}, init);
}) as typeof fetch;
`,
    );
    await writeFile(
      join(fixture, "view.ts"),
      `try {
  const response = await fetch(${JSON.stringify(`${endpoint}/${packageName}`)});
  if (!response.ok) process.exit(1);
  const metadata = await response.json();
  if (!metadata.versions || !Object.hasOwn(metadata.versions, ${JSON.stringify(version)})) process.exit(1);
  console.log(${JSON.stringify(version)});
} catch { process.exit(1); }
`,
    );
    await writeFile(
      join(fixture, "bin/bun"),
      execution.statusOverride === undefined
        ? '#!/bin/bash\nexec "$PUBLICATION_BUN" --no-env-file --preload "$PUBLICATION_PRELOAD" "$@"\n'
        : `#!/bin/bash\nprintf '%s\\n' '${execution.statusOverride}'\n`,
    );
    await writeFile(
      join(fixture, "bin/npm"),
      `#!/bin/bash
if [ "$1" = view ]; then
  exec "$PUBLICATION_BUN" --no-env-file "$PUBLICATION_VIEW"
fi
if [ "$1" = publish ]; then
  printf '%s\\n' "$*" >> "$PUBLICATION_TRACE"
  exit ${execution.publishExit ?? 0}
fi
exit 99
`,
    );
    await chmod(join(fixture, "bin/bun"), 0o700);
    await chmod(join(fixture, "bin/npm"), 0o700);
    const trace = join(fixture, "publish-calls.txt");
    if (registry.disconnected) await server.stop(true);
    const invocation = "publish_package packages/strata-core";
    const child = Bun.spawn(
      [
        "bash",
        "-e",
        "-o",
        "pipefail",
        "-c",
        `${await publicationFunction()}\n${execution.conditional ? `if ${invocation}; then exit 0; else exit $?; fi` : invocation}`,
      ],
      {
        cwd: fixture,
        env: {
          ...process.env,
          PATH: `${join(fixture, "bin")}:${process.env.PATH}`,
          PUBLICATION_BUN: process.execPath,
          PUBLICATION_PRELOAD: join(fixture, "registry-preload.ts"),
          PUBLICATION_VIEW: join(fixture, "view.ts"),
          PUBLICATION_TRACE: trace,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return {
      stdout,
      stderr,
      code,
      calls: (await Bun.file(trace).exists()) ? await readFile(trace, "utf8") : "",
    };
  } finally {
    await server.stop(true);
    await rm(fixture, { recursive: true, force: true });
  }
}

describe("actual workflow publication decision with an owned HTTP registry", () => {
  test("an already published exact version is skipped", async () => {
    const result = await runPublication({
      body: { name: packageName, versions: { [version]: {} } },
    });
    expect(result.code, result.stderr).toBe(0);
    expect(result.calls).toBe("");
    expect(result.stdout).toContain(`Skipping ${packageName}@${version}`);
  });

  test("an authoritative absent version permits the existing publish command", async () => {
    const result = await runPublication({
      body: { name: packageName, versions: { "2.2.58": {} } },
    });
    expect(result.code, result.stderr).toBe(0);
    expect(result.calls).toBe(`publish --workspace ${packageName} --access public --provenance\n`);
  });

  for (const status of [401, 404, 429, 503]) {
    test(`HTTP ${status} aborts before publication`, async () => {
      const result = await runPublication({ status });
      expect(result.calls).toBe("");
      expect(result.code).not.toBe(0);
    });
  }

  test("a disconnected registry aborts before publication", async () => {
    const result = await runPublication({ disconnected: true });
    expect(result.calls).toBe("");
    expect(result.code).not.toBe(0);
  });

  test("registry failure still aborts when Bash errexit is disabled by a conditional call", async () => {
    const result = await runPublication({ status: 503 }, { conditional: true });
    expect(result.calls).toBe("");
    expect(result.code).not.toBe(0);
  });

  test("an unknown helper result cannot permit publication", async () => {
    const result = await runPublication({}, { statusOverride: "unexpected-status" });
    expect(result.calls).toBe("");
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Cannot verify publication state");
  });

  test("a publish command failure reaches the workflow caller", async () => {
    const result = await runPublication(
      { body: { name: packageName, versions: {} } },
      { publishExit: 7 },
    );
    expect(result.calls).toBe(`publish --workspace ${packageName} --access public --provenance\n`);
    expect(result.code).toBe(7);
  });

  for (const [label, registry] of [
    ["malformed JSON", { raw: "{" }],
    ["missing version map", { body: { name: packageName } }],
    ["array version map", { body: { name: packageName, versions: [] } }],
    ["wrong package identity", { body: { name: "other-package", versions: {} } }],
  ] as const) {
    test(`${label} aborts before publication`, async () => {
      const result = await runPublication(registry);
      expect(result.calls).toBe("");
      expect(result.code).not.toBe(0);
    });
  }
});

describe("private publication status CLI input boundary", () => {
  for (const args of [
    [],
    [packageName],
    [packageName, "02.2.59"],
    [packageName, "9007199254740992.0.0"],
    [packageName, "3.0.0-alpha.1"],
    [packageName, " 2.2.59 "],
    [packageName, version, "extra"],
  ]) {
    test(`refuses unsupported input ${JSON.stringify(args)} before a registry request`, async () => {
      const fixture = await mkdtemp(join(tmpdir(), "strata-publication-input-"));
      try {
        const preload = join(fixture, "no-network.ts");
        await writeFile(
          preload,
          'globalThis.fetch = () => { throw new Error("Unexpected registry call"); };\n',
        );
        const child = Bun.spawnSync(
          [
            process.execPath,
            "--no-env-file",
            "--preload",
            preload,
            "scripts/package-publication-status.ts",
            ...args,
          ],
          { cwd: root },
        );
        expect(child.exitCode).toBe(1);
        expect(child.stdout.toString()).toBe("");
        expect(child.stderr.toString()).not.toContain("registry");
      } finally {
        await rm(fixture, { recursive: true, force: true });
      }
    });
  }
});
