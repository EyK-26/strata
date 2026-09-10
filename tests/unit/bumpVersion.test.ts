import { describe, expect, test } from "bun:test";
import {
  compareVersions,
  insertChangelogEntry,
  parseVersion,
  retargetStrataPins,
  setExpectedVersions,
  setPackageVersion,
} from "../../scripts/bump-version.ts";

describe("parseVersion", () => {
  test("accepts a bare semver core", () => {
    expect(parseVersion("1.0.7")).toEqual([1, 0, 7]);
    expect(parseVersion(" 10.20.30 ")).toEqual([10, 20, 30]);
  });

  test("rejects prereleases, partials, and prefixes", () => {
    for (const value of ["v1.0.7", "1.0", "1.0.7-rc.1", "1.0.7+build", ""]) {
      expect(parseVersion(value)).toBeNull();
    }
  });
});

describe("compareVersions", () => {
  test("orders by major, then minor, then patch", () => {
    expect(compareVersions("1.0.7", "1.0.6")).toBe(1);
    expect(compareVersions("1.0.6", "1.0.7")).toBe(-1);
    expect(compareVersions("1.0.6", "1.0.6")).toBe(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
  });

  test("throws on a non-semver operand", () => {
    expect(() => compareVersions("1.0.7", "nope")).toThrow("Not a semver version: nope");
  });
});

describe("setPackageVersion", () => {
  test("rewrites only the top-level version field", () => {
    const before = `{
  "name": "@getstrata/core",
  "version": "1.0.6",
  "dependencies": {
    "eta": "^4.6.0"
  }
}`;
    const after = setPackageVersion(before, "1.0.7");

    expect(after).toContain('"version": "1.0.7"');
    expect(after).toContain('"eta": "^4.6.0"');
  });

  test("is idempotent", () => {
    const once = setPackageVersion('{\n  "version": "1.0.6"\n}', "1.0.7");
    expect(setPackageVersion(once, "1.0.7")).toBe(once);
  });
});

describe("retargetStrataPins", () => {
  test("moves object-form pins and leaves third-party pins alone", () => {
    const before = `"@getstrata/bootstrap": "^1.0.6",
"@getstrata/cli": "^1.0.6",
"@getstrata/core": "^1.0.6",
"eta": "^4.6.0",
"typescript": "^5.9.2"`;
    const after = retargetStrataPins(before, "1.0.7");

    expect(after).toContain('"@getstrata/bootstrap": "^1.0.7"');
    expect(after).toContain('"@getstrata/cli": "^1.0.7"');
    expect(after).toContain('"@getstrata/core": "^1.0.7"');
    expect(after).toContain('"eta": "^4.6.0"');
    expect(after).toContain('"typescript": "^5.9.2"');
  });

  test("moves the assertion form used by the starter tests", () => {
    const before = `expect(pkg.dependencies["@getstrata/core"]).toBe("^1.0.6");`;
    expect(retargetStrataPins(before, "1.0.7")).toBe(
      `expect(pkg.dependencies["@getstrata/core"]).toBe("^1.0.7");`,
    );
  });

  test("moves the create-strata pin", () => {
    expect(retargetStrataPins('"create-strata": "^1.0.6"', "1.0.7")).toBe(
      '"create-strata": "^1.0.7"',
    );
  });

  test("leaves a non-caret value untouched", () => {
    const before = 'pkg.dependencies["@getstrata/core"] = localPackagePath;';
    expect(retargetStrataPins(before, "1.0.7")).toBe(before);
  });

  test("leaves exact pins alone so the EXPECTED map is not double-edited", () => {
    const before = '"@getstrata/core": "1.0.6"';
    expect(retargetStrataPins(before, "1.0.7")).toBe(before);
  });

  test("does not reach across lines", () => {
    const before = '"@getstrata/core"\n"^1.0.6"';
    expect(retargetStrataPins(before, "1.0.7")).toBe(before);
  });

  test("is idempotent", () => {
    const once = retargetStrataPins('"@getstrata/core": "^1.0.6"', "1.0.7");
    expect(retargetStrataPins(once, "1.0.7")).toBe(once);
  });
});

describe("setExpectedVersions", () => {
  const source = `const EXPECTED: Record<string, string> = {
  "@getstrata/core": "1.0.6",
  "create-strata": "1.0.6",
};

const OTHER = { "@getstrata/core": "1.0.6" };`;

  test("rewrites entries inside the EXPECTED block only", () => {
    const after = setExpectedVersions(source, "1.0.7");

    expect(after).toContain('"@getstrata/core": "1.0.7",\n  "create-strata": "1.0.7",');
    expect(after).toContain('const OTHER = { "@getstrata/core": "1.0.6" };');
  });

  test("is idempotent", () => {
    const once = setExpectedVersions(source, "1.0.7");
    expect(setExpectedVersions(once, "1.0.7")).toBe(once);
  });
});

describe("insertChangelogEntry", () => {
  const changelog = `# @getstrata/core changelog

## 1.0.6

- Something shipped.
`;

  test("inserts a new section directly under the title", () => {
    const after = insertChangelogEntry(changelog, "1.0.7", "- New thing.");
    const lines = after.split("\n");

    expect(lines[0]).toBe("# @getstrata/core changelog");
    expect(lines[2]).toBe("## 1.0.7");
    expect(after).toContain("- New thing.");
    expect(after.indexOf("## 1.0.7")).toBeLessThan(after.indexOf("## 1.0.6"));
  });

  test("does not duplicate an existing section", () => {
    expect(insertChangelogEntry(changelog, "1.0.6", "- Ignored.")).toBe(changelog);
  });

  test("writes a heading with no notes when none are given", () => {
    expect(insertChangelogEntry(changelog, "1.0.7")).toContain("## 1.0.7");
  });

  test("prepends when the document has no title", () => {
    expect(insertChangelogEntry("stray text\n", "1.0.7", "- New.")).toStartWith("## 1.0.7");
  });
});
