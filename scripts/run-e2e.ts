import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bunTestsFailed, collectSpawnOutput } from "./bun-test-output";
import { prepareCandidatePackages } from "./candidate-packages";
import { assertE2eFilesExecuted, e2eTestPlan, e2eTestSummary } from "./e2e-test-plan";
import { testWorkerCount, withTestWorkers } from "./test-workers";

const ROOT = resolve(import.meta.dir, "..");
const directory = await mkdtemp(join(tmpdir(), "strata-e2e-run-"));
const cache = join(directory, "packages");
const files = Array.from(new Bun.Glob("tests/e2e/**/*").scanSync(ROOT))
  .filter((file) => /(?:\.|_)(?:test|spec)\.[cm]?[jt]sx?$/.test(file))
  .sort();
const plan = e2eTestPlan(files);
const workers = testWorkerCount();
let success = false;
const summaries: ReturnType<typeof e2eTestSummary>[] = [];
const recorded = JSON.parse(
  await readFile(join(ROOT, "tests/fixtures/e2e-timings.json"), "utf8"),
) as { files: Record<string, number> };
async function run(name: string, selected: string[], env: NodeJS.ProcessEnv, parallel = false) {
  if (!selected.length) return;
  const outputFile = join(directory, `${name}.log`);
  const reportFile = join(directory, `${name}.junit.xml`);
  await writeFile(
    join(directory, `${name}-timings.json`),
    JSON.stringify({
      version: 1,
      files: Object.fromEntries(
        selected
          .filter((file) => recorded.files[file] !== undefined)
          .map((file) => [file, recorded.files[file]]),
      ),
    }),
  );
  const args = [
    process.execPath,
    "test",
    "--no-orphans",
    "--reporter=junit",
    `--reporter-outfile=${reportFile}`,
    ...(parallel ? [`--parallel=${workers}`] : []),
    `--timings=${join(directory, `${name}-timings.json`)}`,
    "--update-timings",
    ...selected.map((file) => `./${file}`),
  ];
  const child = Bun.spawn(args, {
    cwd: ROOT,
    env: { ...env, STRATA_TEST_PACKAGE_DIR: cache },
    stdout: "pipe",
    stderr: "pipe",
  });
  const terminate = () => child.kill("SIGTERM");
  process.once("SIGINT", terminate);
  process.once("SIGTERM", terminate);
  try {
    const result = await collectSpawnOutput(child);
    await writeFile(outputFile, result.output);
    process.stdout.write(result.output);
    assert.ok(
      !bunTestsFailed(result.output, result.exitCode),
      `${name} E2E failed; full log: ${outputFile}`,
    );
    const summary = assertE2eFilesExecuted(await readFile(reportFile, "utf8"), selected, ROOT);
    assert.deepEqual(
      summary,
      e2eTestSummary(result.output),
      "JUnit and console assertion summaries must agree",
    );
    summaries.push(summary);
  } finally {
    process.off("SIGINT", terminate);
    process.off("SIGTERM", terminate);
  }
}

try {
  await writeFile(
    join(directory, "plan.json"),
    JSON.stringify({ files, ...plan, workers }, null, 2),
  );
  await mkdir(cache);
  await prepareCandidatePackages(cache);
  const errors: unknown[] = [];
  try {
    await run("serial", plan.serial, process.env);
  } catch (error) {
    errors.push(error);
  }
  try {
    await withTestWorkers(workers, (env) => run("parallel", plan.parallel, env, true));
  } catch (error) {
    errors.push(error);
  }
  if (errors.length)
    throw new AggregateError(errors, "E2E phases failed; all phases were attempted");
  success = true;
  console.log(
    `E2E inventory complete: ${files.length} files, ${plan.serial.length} serial + ${plan.parallel.length} isolated-worker files.`,
  );
  const total = summaries.reduce(
    (sum, value) => ({
      pass: sum.pass + value.pass,
      fail: sum.fail + value.fail,
      skip: sum.skip + value.skip,
      assertions: sum.assertions + value.assertions,
    }),
    { pass: 0, fail: 0, skip: 0, assertions: 0 },
  );
  console.log(
    `\n ${total.pass} pass\n ${total.skip} skip\n ${total.fail} fail\n ${total.assertions} expect() calls\nE2E totals include both phases.`,
  );
} finally {
  if (success) await rm(directory, { recursive: true, force: true });
  else console.error(`E2E diagnostics retained: ${directory}`);
}
