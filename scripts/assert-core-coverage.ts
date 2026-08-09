#!/usr/bin/env bun
/**
 * Fail if any in-scope framework file is below 100% lines.
 * Bun's coverageThreshold cannot be used: core tests load HiroApp createApp
 * via OpenAPI, which would fail an aggregate 100% gate.
 */

import {
  bunTestsFailed,
  collectSpawnOutput,
  digestBunTestOutput,
  reportBunTestFailure,
} from "./bun-test-output.ts";

const IGNORE_PREFIXES = [
  "src/cli/",
  "src/bootstrap/",
  "src/db/",
  "src/core/database/migrations/",
  "src/core/database/schema/",
  "src/core/database/whereBuilder.ts",
  "src/core/database/query.ts",
  "src/framework/",
  "src/testing/",
  "src/core/facades/",
  "src/core/runtime/applicationRegistry.ts",
  "src/core/queue/jobRegistry.ts",
  "src/core/contracts/container.ts",
  "src/core/contracts/di.ts",
  "src/core/contracts/serviceTokens.ts",
  "src/core/tracing/",
  "src/core/database/model.ts",
  "src/core/database/factory.ts",
  "src/core/database/relationQuery.ts",
  "src/core/notifications/notification.ts",
  "src/core/database/bindConnection.ts",
  "src/core/database/boundConnection.ts",
  "src/core/database/bunSql.ts",
  "src/core/database/defaultConnection.ts",
  "src/core/database/queryProxy.ts",
  "src/core/database/repositoryConnection.ts",
  "src/core/http/",
  "src/core/view/",
  "src/core/config/",
  "src/core/cache/",
  "src/core/storage/",
  "src/core/mail/",
  "src/core/metrics/",
  "src/core/logging/",
  "src/core/openapi/",
  "src/core/scheduler/",
  "src/config/",
  "src/core/queue/createAppQueue.ts",
  "src/core/queue/index.ts",
  "src/core/queue/queueMetrics.ts",
  "src/core/queue/redisQueue.ts",
  "src/core/queue/resilientQueue.ts",
  "src/core/queue/publicQueue.ts",
  "src/listeners/",
  "src/core/jobs/",
  "src/core/auth/guard.ts",
  "src/core/auth/sessionGuard.ts",
];

function isIgnored(file: string): boolean {
  return IGNORE_PREFIXES.some((prefix) => file === prefix || file.startsWith(prefix));
}

const env = { ...process.env };
delete env.HIROAPP_TEST;
delete env.API_PREFIX;
if ((env.DOGFOOD_APP ?? "").trim().toLowerCase() === "hiroapp") {
  delete env.DOGFOOD_APP;
}

const proc = Bun.spawn(
  [
    "bun",
    "test",
    "--coverage",
    "--coverage-reporter=text",
    "--max-concurrency=1",
    "tests/unit",
    "tests/integration",
  ],
  {
    cwd: process.cwd(),
    env: {
      ...env,
      CACHE_DRIVER: process.env.CACHE_DRIVER ?? "array",
      QUEUE_DRIVER: process.env.QUEUE_DRIVER ?? "sync",
      APP_KEY_PREFIX: "strata",
      APP_NAME: "Strata",
    },
    stdout: "pipe",
    stderr: "pipe",
  },
);

const { output, exitCode } = await collectSpawnOutput(proc);
process.stdout.write(digestBunTestOutput(output));

if (bunTestsFailed(output, exitCode)) {
  reportBunTestFailure("Core", output, exitCode);
  process.exit(exitCode === 0 ? 1 : exitCode);
}

const uncovered: string[] = [];
const seen = new Set<string>();
for (const line of output.split("\n")) {
  const match = line.match(/^\s+(src\/\S+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/);
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
  console.error("Core coverage gate found no in-scope src/ files.");
  process.exit(1);
}

if (uncovered.length > 0) {
  console.error("Core coverage is below 100%:\n");
  console.error(uncovered.join("\n"));
  process.exit(1);
}

console.log(`Core coverage gate passed (${seen.size} files).`);
