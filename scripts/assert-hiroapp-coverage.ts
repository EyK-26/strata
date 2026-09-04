#!/usr/bin/env bun
/**
 * Wave 10: fail if any in-scope HiroApp domain file is below 100% coverage.
 * Bun's coverageThreshold also measures imported @getstrata/core files in the
 * same process, so this script is the HiroApp gate.
 */

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
  /\/catalog\//,
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
      FRONTEND_MODE: "server-htmx",
      HIROAPP_SEED_SCALE: "demo",
    },
    stdout: "pipe",
    stderr: "pipe",
  },
);

const output = `${await new Response(proc.stdout).text()}${await new Response(proc.stderr).text()}`;
const exitCode = await proc.exited;
process.stdout.write(output);

if (!/\n 0 fail\n/.test(output) && !/\n0 fail\n/.test(output)) {
  console.error("HiroApp tests failed.");
  process.exit(exitCode === 0 ? 1 : exitCode);
}

const uncovered: string[] = [];
const seen = new Set<string>();
for (const line of output.split("\n")) {
  const match = line.match(/^\s+(apps\/hiroapp\/src\/\S+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/);
  if (!match) {
    continue;
  }
  const file = match[1] ?? "";
  if (isIgnored(file) || seen.has(file)) {
    continue;
  }
  seen.add(file);
  const lines = Number(match[3]);
  if (lines < 100) {
    uncovered.push(`${file} funcs=${match[2]} lines=${match[3]}`);
  }
}

if (seen.size === 0) {
  console.error("HiroApp coverage gate found no apps/hiroapp/src files.");
  process.exit(1);
}

if (uncovered.length > 0) {
  console.error("HiroApp domain coverage is below 100%:\n");
  console.error(uncovered.join("\n"));
  process.exit(1);
}

console.log(`HiroApp domain coverage gate passed (${seen.size} files).`);
