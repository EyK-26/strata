import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidatePackage } from "../../scripts/candidate-packages";
import { assertE2eFilesExecuted, e2eTestPlan, e2eTestSummary } from "../../scripts/e2e-test-plan";
import { testWorkerCount } from "../../scripts/test-workers";
import { testWorkerEnvironment, WORKER_ENVIRONMENT_KEYS } from "../helpers/testWorkerEnvironment";

describe("test execution harness contracts", () => {
  test("partitions every file once and leaves new/unreviewed files serial", () => {
    const files = [
      "tests/e2e/generatedRuntime.test.ts",
      "tests/e2e/newContract.test.ts",
      "tests/e2e/generatedDocker.test.ts",
    ] as const;
    const plan = e2eTestPlan(files);
    expect(plan.parallel).toEqual([files[0]]);
    expect(plan.serial).toEqual(files.slice(1));
    expect([...plan.serial, ...plan.parallel].sort()).toEqual([...files].sort());
  });
  test("implicit child environments and cluster-role rotation remain serial", () => {
    const files = [
      "formMultiplicity",
      "generatedGuestTenancy",
      "generatedMysqlMigrationRole",
      "generatedReactAuth",
      "mailDriverExtension",
      "modelGenerator",
      "postgresRuntimeGrants",
      "viewGenerator",
    ].map((name) => `tests/e2e/${name}.test.ts`);
    const plan = e2eTestPlan(files);
    expect(plan.serial).toEqual(files);
    expect(plan.parallel).toEqual([]);
  });
  test("rejects duplicate and missing discovery rather than silently dropping files", () => {
    expect(() => e2eTestPlan([])).toThrow();
    expect(() => e2eTestPlan(["tests/e2e/example.test.ts", "tests/e2e/example.test.ts"])).toThrow();
  });
  test("requires native execution reports, rejecting missing and duplicate suites/cases", () => {
    const file = "tests/e2e/example.test.ts";
    const suite = `<testsuite file="${file}" tests="1" assertions="1" failures="0" skipped="0"><testcase name="a" /></testsuite>`;
    const report = (body: string, tests = 1) =>
      `<testsuites tests="${tests}" assertions="${tests}" failures="0" skipped="0">${body}</testsuites>`;
    expect(() => assertE2eFilesExecuted(report(suite), [file])).not.toThrow();
    expect(() => assertE2eFilesExecuted(report("", 0), [file])).toThrow();
    expect(() => assertE2eFilesExecuted(report(suite + suite, 2), [file])).toThrow();
    expect(() =>
      assertE2eFilesExecuted(report(suite.replace('<testcase name="a" />', "")), [file]),
    ).toThrow();
    const duplicate = suite
      .replace('tests="1" assertions="1"', 'tests="2" assertions="2"')
      .replace('<testcase name="a" />', '<testcase name="a" /><testcase name="a" />');
    expect(() => assertE2eFilesExecuted(report(duplicate, 2), [file])).toThrow();
    const grouped = suite
      .replace('tests="1" assertions="1"', 'tests="2" assertions="2"')
      .replace(
        "</testsuite>",
        `<testsuite name="nested group" tests="1" assertions="1" failures="0" skipped="0"><testcase name="a" /></testsuite></testsuite>`,
      );
    expect(assertE2eFilesExecuted(report(grouped, 2), [file])).toEqual({
      pass: 2,
      fail: 0,
      skip: 0,
      assertions: 2,
    });
  });
  test("aggregates native assertion summaries without treating missing output as a pass", () => {
    expect(e2eTestSummary(" 3 pass\n 0 fail\n 4 expect() calls\n")).toEqual({
      pass: 3,
      fail: 0,
      skip: 0,
      assertions: 4,
    });
    expect(() => e2eTestSummary(" 0 fail\n")).toThrow();
  });
  test("worker count is explicit and bounded without silent fallback", () => {
    for (const count of ["1", "2", "3", "4"]) expect(testWorkerCount(count)).toBe(Number(count));
    for (const count of ["0", "5", "2x", "", "-1"]) expect(() => testWorkerCount(count)).toThrow();
  });
  test("selects every service URL from the current worker before database imports", () => {
    const one = Object.fromEntries(WORKER_ENVIRONMENT_KEYS.map((key) => [key, `one-${key}`]));
    const two = Object.fromEntries(WORKER_ENVIRONMENT_KEYS.map((key) => [key, `two-${key}`]));
    const data = { version: 1, workers: { "1": one, "2": two } };
    expect(testWorkerEnvironment(data, "1")).toEqual(one);
    expect(testWorkerEnvironment(data, "2")).toEqual(two);
  });
  test("missing or malformed worker configuration fails closed", () => {
    expect(() => testWorkerEnvironment({ version: 1, workers: {} }, "2")).toThrow();
    expect(() => testWorkerEnvironment({ version: 1, workers: { "2": {} } }, "2")).toThrow();
    expect(() => testWorkerEnvironment({ version: 2, workers: {} }, "1")).toThrow();
    expect(() => testWorkerEnvironment(null, "1")).toThrow();
  });
});

async function withArchive(
  run: (
    directory: string,
    manifest: {
      version: number;
      root: string;
      archives: Record<string, { file: string; sha256: string; manifestSha256: string }>;
    },
  ) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "strata-archive-contract-"));
  const previous = process.env.STRATA_TEST_PACKAGE_DIR;
  const root = await realpath(join(import.meta.dir, "../.."));
  const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
  const bytes = new TextEncoder().encode("owned archive contract bytes");
  const manifest = {
    version: 1,
    root,
    archives: {
      core: {
        file: "core.tgz",
        sha256: digest(bytes),
        manifestSha256: digest(await readFile(join(root, "packages/strata-core/package.json"))),
      },
    },
  };
  try {
    await writeFile(join(directory, "core.tgz"), bytes);
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
    process.env.STRATA_TEST_PACKAGE_DIR = directory;
    await run(directory, manifest);
  } finally {
    if (previous === undefined) delete process.env.STRATA_TEST_PACKAGE_DIR;
    else process.env.STRATA_TEST_PACKAGE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

describe("run-scoped candidate archives", () => {
  test("reuses the same verified bytes for independent consumers", async () => {
    await withArchive(async (directory) => {
      const first = await candidatePackage("core", join(directory, "one"));
      const second = await candidatePackage("core", join(directory, "two"));
      expect(first).toBe(join(directory, "core.tgz"));
      expect(second).toBe(first);
    });
  });
  test("corrupt archives fail rather than falling back to unverified repacking", async () => {
    await withArchive(async (directory) => {
      await writeFile(join(directory, "core.tgz"), "changed");
      await expect(candidatePackage("core", directory)).rejects.toThrow(
        "Candidate archive changed",
      );
    });
  });
  test("stale package manifests and another checkout are refused", async () => {
    await withArchive(async (directory, manifest) => {
      const entry = manifest.archives.core;
      expect(entry).toBeDefined();
      if (!entry) throw new Error("Missing owned contract entry");
      entry.manifestSha256 = "outdated";
      await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
      await expect(candidatePackage("core", directory)).rejects.toThrow("Package changed");
      manifest.root = join(directory, "another-checkout");
      await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
      await expect(candidatePackage("core", directory)).rejects.toThrow("another checkout");
    });
  });
});
