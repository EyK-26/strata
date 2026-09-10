import { describe, expect, test } from "bun:test";
import {
  type CoverageRow,
  checkRatchet,
  evaluateCoverage,
  isTypeOnlyModule,
  parseCoverageRows,
} from "../../scripts/coverage-scope.ts";

const REPORT = `
-------------------------------|---------|---------|-------------------
File                           | % Funcs | % Lines | Uncovered Line #s
-------------------------------|---------|---------|-------------------
All files                      |   91.20 |   88.40 |
 src/core/auth/policy.ts       |  100.00 |  100.00 |
 src/core/auth/jwt.ts          |   90.00 |   72.50 | 41-48,80
 src/core/http/response.ts     |   50.00 |   33.00 | 12-90
-------------------------------|---------|---------|-------------------
`;

describe("parseCoverageRows", () => {
  test("reads funcs and lines for each src file and ignores summary rows", () => {
    expect(parseCoverageRows(REPORT)).toEqual([
      { file: "src/core/auth/policy.ts", funcs: 100, lines: 100 },
      { file: "src/core/auth/jwt.ts", funcs: 90, lines: 72.5 },
      { file: "src/core/http/response.ts", funcs: 50, lines: 33 },
    ]);
  });

  test("keeps the first row when bun repeats a file across suites", () => {
    const rows = parseCoverageRows(
      " src/a.ts | 100.00 | 100.00 |\n src/a.ts | 10.00 | 10.00 |\n".replace(/src/g, "src/core"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lines).toBe(100);
  });

  test("returns nothing for output without a coverage table", () => {
    expect(parseCoverageRows("12 pass\n0 fail\n")).toEqual([]);
  });
});

describe("isTypeOnlyModule", () => {
  test("treats erased output as type-only, including comment-only leftovers", () => {
    expect(isTypeOnlyModule("")).toBe(true);
    expect(isTypeOnlyModule("   \n\t ")).toBe(true);
    expect(isTypeOnlyModule("// interface erased\n")).toBe(true);
    expect(isTypeOnlyModule("/* block */\n\n")).toBe(true);
  });

  test("treats any emitted statement as runtime code", () => {
    expect(isTypeOnlyModule('export * from "./a.js";')).toBe(false);
    expect(isTypeOnlyModule("// note\nconst a = 1;")).toBe(false);
  });
});

describe("evaluateCoverage", () => {
  const rows: CoverageRow[] = [
    { file: "src/core/a.ts", funcs: 100, lines: 100 },
    { file: "src/core/b.ts", funcs: 80, lines: 60 },
    { file: "src/core/exempt-done.ts", funcs: 100, lines: 100 },
    { file: "src/core/exempt-open.ts", funcs: 10, lines: 20 },
  ];

  test("fails enforced files under 100% and leaves exempt files alone", () => {
    const result = evaluateCoverage({
      rows,
      sourceFiles: ["src/core/a.ts", "src/core/b.ts", "src/core/exempt-open.ts"],
      exemptFiles: ["src/core/exempt-open.ts"],
    });

    expect(result.uncovered.map((row) => row.file)).toEqual(["src/core/b.ts"]);
    expect(result.enforcedCount).toBe(2);
    expect(result.exemptCount).toBe(1);
  });

  test("enforces a brand new file by default instead of inheriting a directory exemption", () => {
    const result = evaluateCoverage({
      rows: [...rows, { file: "src/core/http/brand-new.ts", funcs: 0, lines: 0 }],
      sourceFiles: ["src/core/a.ts", "src/core/http/brand-new.ts"],
      exemptFiles: ["src/core/http/existing.ts"],
    });

    expect(result.uncovered.map((row) => row.file)).toEqual(["src/core/http/brand-new.ts"]);
  });

  test("reports an enforced file that no test ever loaded", () => {
    const result = evaluateCoverage({
      rows,
      sourceFiles: ["src/core/a.ts", "src/core/never-imported.ts"],
      exemptFiles: [],
    });

    expect(result.neverLoaded).toEqual(["src/core/never-imported.ts"]);
  });

  test("does not report type-only modules as unloaded", () => {
    const result = evaluateCoverage({
      rows,
      sourceFiles: ["src/core/a.ts", "src/core/types.ts"],
      exemptFiles: [],
      typeOnlyFiles: ["src/core/types.ts"],
    });

    expect(result.neverLoaded).toEqual([]);
    expect(result.enforcedCount).toBe(2);
  });

  test("flags exemptions whose file was deleted or renamed", () => {
    const result = evaluateCoverage({
      rows,
      sourceFiles: ["src/core/a.ts"],
      exemptFiles: ["src/core/gone.ts", "src/core/also-gone.ts"],
    });

    expect(result.staleExemptions).toEqual(["src/core/also-gone.ts", "src/core/gone.ts"]);
  });

  test("reports exempt files that now reach 100% so the debt list can shrink", () => {
    const result = evaluateCoverage({
      rows,
      sourceFiles: ["src/core/exempt-done.ts", "src/core/exempt-open.ts"],
      exemptFiles: ["src/core/exempt-done.ts", "src/core/exempt-open.ts"],
    });

    expect(result.redeemable).toEqual(["src/core/exempt-done.ts"]);
  });

  test("counts nothing as enforced when every file is exempt", () => {
    const result = evaluateCoverage({
      rows,
      sourceFiles: ["src/core/a.ts"],
      exemptFiles: ["src/core/a.ts"],
    });

    expect(result.enforcedCount).toBe(0);
    expect(result.uncovered).toEqual([]);
  });
});

describe("checkRatchet", () => {
  test("passes when the debt list matches the recorded ceiling", () => {
    expect(checkRatchet(274, 274)).toEqual([]);
  });

  test("fails when exemptions grow", () => {
    const [error] = checkRatchet(275, 274);
    expect(error).toContain("grew from 274 to 275");
  });

  test("fails when exemptions shrink so the ceiling gets locked in", () => {
    const [error] = checkRatchet(270, 274);
    expect(error).toContain("lower COVERAGE_EXEMPT_LIMIT to 270");
  });
});
