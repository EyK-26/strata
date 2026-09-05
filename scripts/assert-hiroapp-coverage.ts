#!/usr/bin/env bun
/**
 * Wave 10: fail if any in-scope HiroApp domain file is below 100% coverage.
 * Bun's coverageThreshold also measures imported @getstrata/core files in the
 * same process, so this script is the HiroApp gate.
 */

import {
  bunTestsFailed,
  collectSpawnOutput,
  digestBunTestOutput,
  reportBunTestFailure,
} from "./bun-test-output.ts";

const ignore = [
  /\/bootstrap\//,
  /\/db\//,
  /\/http\//,
  /\/tests\//,
  /\/models\//,
  /\/scripts\//,
  /\/jobs\//,
  /\/observers\//,
  /\/listeners\//,
  /\/events\//,
  /schedule\.ts$/,
  /\/index\.ts$/,
  /\/routes\.ts$/,
  /\/web\.ts$/,
  /\/requests\.ts$/,
  /\/table\.ts$/,
  /Table\.ts$/,
  /\/policy\.ts$/,
  /\/schemas\.ts$/,
  /\/serialize\.ts$/,
  /\/presenters\.ts$/,
  /\/loaders\.ts$/,
  /\/tables\.ts$/,
];

function isIgnored(file: string): boolean {
  return ignore.some((pattern) => pattern.test(file));
}

const proc = Bun.spawn(
  [
    "bun",
    "test",
    "--coverage",
    "--coverage-reporter=text",
    "--max-concurrency=1",
    "--preload",
    "./apps/hiroapp/src/tests/preload.ts",
    "./apps/hiroapp/src/tests",
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HIROAPP_TEST: "1",
      DOGFOOD_APP: "hiroapp",
      QUEUE_DRIVER: "sync",
      MAIL_DRIVER: "log",
      CACHE_DRIVER: "array",
      FRONTEND_MODE: "hybrid",
      SPA_PREFIX: "/apply",
      HIROAPP_SEED_SCALE: "demo",
      LOGIN_RATE_LIMIT_PER_WINDOW: "10000",
    },
    stdout: "pipe",
    stderr: "pipe",
  },
);

const { output, exitCode } = await collectSpawnOutput(proc);
process.stdout.write(digestBunTestOutput(output));

if (bunTestsFailed(output, exitCode)) {
  reportBunTestFailure("HiroApp", output, exitCode);
  process.exit(exitCode === 0 ? 1 : exitCode);
}

const rows = new Map<string, { funcs: string; lines: string }>();
for (const line of output.split("\n")) {
  const match = line.match(/^\s+(apps\/hiroapp\/src\/\S+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/);
  if (!match) {
    continue;
  }
  const file = match[1] ?? "";
  if (isIgnored(file)) {
    continue;
  }
  rows.set(file, { funcs: match[2] ?? "0", lines: match[3] ?? "0" });
}

const uncovered = [...rows.entries()]
  .filter(([, stats]) => Number(stats.lines) < 100)
  .map(([file, stats]) => `${file} funcs=${stats.funcs} lines=${stats.lines}`);

if (rows.size === 0) {
  console.error("HiroApp coverage gate found no apps/hiroapp/src files.");
  process.exit(1);
}

if (uncovered.length > 0) {
  console.error("HiroApp domain coverage is below 100%:\n");
  console.error(uncovered.join("\n"));
  process.exit(1);
}

console.log(`HiroApp domain coverage gate passed (${rows.size} files).`);
