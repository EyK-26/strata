#!/usr/bin/env bun

/**
 * Typecheck freshly generated apps against the PUBLISHED package layout.
 *
 * The monorepo tsconfig maps `@getstrata/core/*` to `./src/core/*`, so running
 * `tsc` inside the repo cannot see a missing `exports` entry or a broken `.d.ts`
 * path. This script packs the four packages, generates apps into a temp
 * directory outside the repo, installs the tarballs, and runs the app's own
 * `bun run check`. That is the only place a first-time user's experience is
 * reproduced.
 *
 * Run: bun scripts/verify-generated-app.ts
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "bun";

const ROOT = join(import.meta.dir, "..");

const PACKAGE_DIRS = [
  "packages/strata-core",
  "packages/strata-bootstrap",
  "packages/strata-cli",
  "packages/strata-starter",
];

/** One case per code path the generator can emit. Keep MySQL and every auth kit covered. */
const CASES: Array<{ name: string; flags: string[] }> = [
  { name: "api-sqlite-headers", flags: [] },
  {
    name: "htmx-sqlite-cookie",
    flags: ["--frontend", "server-htmx", "--database", "sqlite", "--auth", "cookie"],
  },
  {
    name: "htmx-postgres-cookie-all-extras",
    flags: [
      "--frontend",
      "server-htmx",
      "--database",
      "postgres",
      "--auth",
      "cookie-token-jwt",
      "--tenancy",
      "rls",
      "--mfa",
      "--email-verification",
      "--scim",
      "--metrics",
    ],
  },
  {
    name: "api-mysql-token",
    flags: ["--frontend", "api", "--database", "mysql", "--auth", "token"],
  },
  {
    name: "hybrid-sqlite-cookie-token",
    flags: ["--frontend", "hybrid", "--database", "sqlite", "--auth", "cookie-token"],
  },
];

async function run(
  command: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<{ exitCode: number; output: string }> {
  const proc = spawn(command, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, output: `${stdout}${stderr}` };
}

async function packPackages(destination: string): Promise<Record<string, string>> {
  const tarballs: Record<string, string> = {};
  for (const dir of PACKAGE_DIRS) {
    const manifest = JSON.parse(await readFile(join(ROOT, dir, "package.json"), "utf8")) as {
      name: string;
    };
    const packed = await run(
      ["npm", "pack", "--silent", "--pack-destination", destination],
      join(ROOT, dir),
    );
    if (packed.exitCode !== 0) {
      throw new Error(`npm pack failed for ${dir}:\n${packed.output}`);
    }
    const file = packed.output.trim().split("\n").filter(Boolean).at(-1);
    if (!file) {
      throw new Error(`npm pack produced no tarball for ${dir}`);
    }
    tarballs[manifest.name] = join(destination, file);
  }
  return tarballs;
}

/** Point the generated app at the packed tarballs instead of the registry. */
async function useTarballs(appDir: string, tarballs: Record<string, string>): Promise<void> {
  const path = join(appDir, "package.json");
  const manifest = JSON.parse(await readFile(path, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  for (const [name, tarball] of Object.entries(tarballs)) {
    if (manifest.dependencies?.[name]) {
      manifest.dependencies[name] = `file:${tarball}`;
    }
  }
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

const workspace = await mkdtemp(join(tmpdir(), "strata-verify-"));
const failures: string[] = [];

try {
  const tarballs = await packPackages(workspace);
  const starterCli = join(ROOT, "packages/strata-starter/dist/cli.js");

  for (const testCase of CASES) {
    const generated = await run(
      ["bun", starterCli, testCase.name, "--yes", ...testCase.flags],
      workspace,
    );
    if (generated.exitCode !== 0) {
      failures.push(`${testCase.name}: generate failed\n${generated.output}`);
      continue;
    }

    const appDir = join(workspace, testCase.name);
    await useTarballs(appDir, tarballs);

    const installed = await run(["bun", "install"], appDir);
    if (installed.exitCode !== 0) {
      failures.push(`${testCase.name}: bun install failed\n${installed.output}`);
      continue;
    }

    const checked = await run(["bun", "run", "check"], appDir);
    if (checked.exitCode === 0) {
      console.log(`ok   ${testCase.name}`);
      continue;
    }
    failures.push(`${testCase.name}: bun run check failed\n${checked.output}`);
    console.log(`FAIL ${testCase.name}`);
  }
} finally {
  await rm(workspace, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\nGenerated apps must typecheck against published packages:\n`);
  console.error(failures.join("\n\n"));
  process.exit(1);
}

console.log(`\nGenerated app typecheck gate passed (${CASES.length} layer combinations).`);
