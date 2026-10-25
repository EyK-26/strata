import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";

// Use the existing XML implementation through its small report-reading protocol. Importing its
// global DOM declarations changes Bun's FormData/Response types across unrelated source files.
interface ReportElement {
  readonly parentNode: object | null;
  tagName: string;
  getAttribute(name: string): string | null;
  getElementsByTagName(name: string): ArrayLike<ReportElement>;
}
const { DOMParser } = createRequire(import.meta.url)("@xmldom/xmldom") as {
  DOMParser: new (options: {
    errorHandler: Record<string, (message: string) => void>;
  }) => {
    parseFromString(
      text: string,
      type: string,
    ): {
      documentElement: ReportElement | null;
      getElementsByTagName(name: string): ArrayLike<ReportElement>;
    };
  };
};

// Qualified for isolated backend workers, including explicit child environment forwarding.
// Bun's isolated process.env does not replace the OS environment inherited by implicit spawns.
// New files and implicit-environment verifiers stay serial until reviewed here.
const PARALLEL_E2E_FILES = new Set(
  [
    "auditExportContracts",
    "generatedAdminReset",
    "generatedApp.security",
    "generatedAuthJourneys",
    "generatedBillingRollback",
    "generatedModule",
    "generatedOidc",
    "generatedResetContention",
    "generatedRuntime",
    "generatedSaml",
    "generatedStartupCleanup",
    "modelAttributeContracts",
    "modelQueryContracts",
    "modelRegistryContracts",
    "modelWriteHooks",
    "moduleCachedJson",
    "nativeRouteContracts",
    "providerPhaseAdmission",
    "redisProtocolContracts",
    "relationQueryContracts",
    "repositoryRebinding",
    "routeCollisionContracts",
    "starterCombinations",
    "starterCsrfTargetOrigin",
  ].map((name) => `tests/e2e/${name}.test.ts`),
);

function e2eTestPlan(files: readonly string[]) {
  assert.ok(files.length > 0, "No E2E test files discovered");
  assert.equal(new Set(files).size, files.length, "Duplicate E2E test file");
  for (const file of files)
    assert.match(file, /^tests\/e2e\/.+(?:\.|_)(?:test|spec)\.[cm]?[jt]sx?$/);
  const parallel = files.filter((file) => PARALLEL_E2E_FILES.has(file));
  const serial = files.filter((file) => !PARALLEL_E2E_FILES.has(file));
  assert.deepEqual([...serial, ...parallel].sort(), [...files].sort());
  return { serial, parallel };
}

function assertE2eFilesExecuted(report: string, selected: readonly string[], root = process.cwd()) {
  const document = new DOMParser({
    errorHandler: {
      warning(message) {
        throw new Error(message);
      },
      error(message) {
        throw new Error(message);
      },
      fatalError(message) {
        throw new Error(message);
      },
    },
  }).parseFromString(report, "application/xml");
  const summary = document.documentElement;
  assert.ok(summary, "Missing native JUnit document");
  assert.equal(summary.tagName, "testsuites", "Missing native JUnit execution report");
  const count = (element: ReportElement, name: string) => {
    const value = element.getAttribute(name) ?? "";
    assert.match(value, /^\d+$/, `Missing JUnit ${name}`);
    return Number(value);
  };
  const files: string[] = [];
  let tests = 0,
    failures = 0,
    skipped = 0,
    assertions = 0;
  const cases = new Map<object, Set<string>>();
  // Bun puts describe groups in nested suites. Only direct root children represent files;
  // each file's declared totals already include its nested groups and their test cases.
  const fileSuites = Array.from(document.getElementsByTagName("testsuite")).filter(
    (suite) => suite.parentNode === summary,
  );
  for (const suite of fileSuites) {
    const file = suite.getAttribute("file");
    assert.ok(file, "Missing JUnit source file");
    files.push(relative(root, resolve(root, file)));
    const records = Array.from(suite.getElementsByTagName("testcase"));
    for (const record of records) {
      const name = record.getAttribute("name");
      assert.ok(name, "Missing JUnit case identity");
      const key: string = JSON.stringify([
        file,
        record.getAttribute("classname"),
        name,
        record.getAttribute("line"),
      ]);
      const scope = record.parentNode;
      assert.ok(scope, "Missing JUnit case scope");
      const scopedCases = cases.get(scope) ?? new Set<string>();
      assert.ok(!scopedCases.has(key), "Duplicate JUnit case execution");
      scopedCases.add(key);
      cases.set(scope, scopedCases);
    }
    const actual = records.length;
    assert.equal(
      actual,
      count(suite, "tests"),
      "JUnit case inventory disagrees with suite summary",
    );
    tests += actual;
    failures += count(suite, "failures");
    skipped += count(suite, "skipped");
    assertions += count(suite, "assertions");
  }
  assert.deepEqual(
    files.sort(),
    [...selected].sort(),
    "Every selected E2E file must execute exactly once",
  );
  assert.equal(tests, count(summary, "tests"));
  assert.equal(failures, count(summary, "failures"));
  assert.equal(skipped, count(summary, "skipped"));
  assert.equal(assertions, count(summary, "assertions"));
  return { pass: tests - failures - skipped, fail: failures, skip: skipped, assertions };
}

function e2eTestSummary(output: string) {
  const counts = new Map<string, number>();
  for (const line of Bun.stripANSI(output).split(/\r?\n/)) {
    const match = /^\s*(\d+) (pass|fail|skip|expect\(\) calls)\s*$/.exec(line);
    if (match?.[1] && match[2]) counts.set(match[2], Number(match[1]));
  }
  assert.ok(
    counts.has("pass") && counts.has("fail") && counts.has("expect() calls"),
    "Missing Bun assertion summary",
  );
  return {
    pass: counts.get("pass") ?? 0,
    fail: counts.get("fail") ?? 0,
    skip: counts.get("skip") ?? 0,
    assertions: counts.get("expect() calls") ?? 0,
  };
}

export { assertE2eFilesExecuted, e2eTestPlan, e2eTestSummary };
