#!/usr/bin/env bun

import {
  bunTestsFailed,
  collectSpawnOutput,
  digestBunTestOutput,
  reportBunTestFailure,
} from "./bun-test-output.ts";
import { COVERAGE_EXEMPT_FILES, COVERAGE_EXEMPT_LIMIT } from "./coverage-baseline.ts";
import {
  checkRatchet,
  evaluateCoverage,
  isTypeOnlyModule,
  parseCoverageRows,
} from "./coverage-scope.ts";

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

const sourceFiles: string[] = [];
const typeOnlyFiles: string[] = [];
const transpiler = new Bun.Transpiler({ loader: "ts" });

for (const file of new Bun.Glob("src/**/*.ts").scanSync(process.cwd())) {
  const normalized = file.replaceAll("\\", "/");
  if (normalized.endsWith(".d.ts")) {
    continue;
  }
  sourceFiles.push(normalized);
  if (isTypeOnlyModule(transpiler.transformSync(await Bun.file(normalized).text()))) {
    typeOnlyFiles.push(normalized);
  }
}

const result = evaluateCoverage({
  rows: parseCoverageRows(output),
  sourceFiles,
  exemptFiles: COVERAGE_EXEMPT_FILES,
  typeOnlyFiles,
});

const failures = [...checkRatchet(result.exemptCount, COVERAGE_EXEMPT_LIMIT)];

if (result.enforcedCount === 0) {
  failures.push("Core coverage gate found no enforced src/ files.");
}

if (result.staleExemptions.length > 0) {
  failures.push(
    `Coverage exemptions point at files that no longer exist; delete them from coverage-baseline.ts:\n${result.staleExemptions
      .map((file) => `  ${file}`)
      .join("\n")}`,
  );
}

if (result.neverLoaded.length > 0) {
  failures.push(
    `Enforced files were never loaded by any test, so their coverage is unknown:\n${result.neverLoaded
      .map((file) => `  ${file}`)
      .join("\n")}`,
  );
}

if (result.uncovered.length > 0) {
  failures.push(
    `Core coverage is below 100%:\n${result.uncovered
      .map((row) => `  ${row.file} funcs=${row.funcs} lines=${row.lines}`)
      .join("\n")}`,
  );
}

if (failures.length > 0) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}

if (result.redeemable.length > 0) {
  console.log(
    `${result.redeemable.length} exempt file(s) now reach 100%. Remove them from coverage-baseline.ts and lower COVERAGE_EXEMPT_LIMIT:\n${result.redeemable
      .map((file) => `  ${file}`)
      .join("\n")}`,
  );
}

console.log(
  `Core coverage gate passed (${result.enforcedCount} enforced, ${result.exemptCount} exempt).`,
);
