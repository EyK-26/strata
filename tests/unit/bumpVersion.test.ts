import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareVersions,
  insertChangelogEntry,
  parseVersion,
  retargetStrataPins,
  setExpectedVersions,
  setPackageVersion,
  setPublishedReadmeVersion,
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

describe("setPublishedReadmeVersion", () => {
  const readme = `# Strata

Published as **1.0.8**:

| Package | What it is |
`;

  test("rewrites the Published as line", () => {
    expect(setPublishedReadmeVersion(readme, "1.0.9")).toContain("Published as **1.0.9**:");
    expect(setPublishedReadmeVersion(readme, "1.0.9")).not.toContain("Published as **1.0.8**");
  });

  test("is idempotent", () => {
    const once = setPublishedReadmeVersion(readme, "1.0.9");
    expect(setPublishedReadmeVersion(once, "1.0.9")).toBe(once);
  });

  test("leaves unrelated version numbers alone", () => {
    const mixed = `${readme}\nSee 1.0.8 in the changelog.\n`;
    const after = setPublishedReadmeVersion(mixed, "1.0.9");
    expect(after).toContain("See 1.0.8 in the changelog.");
  });

  test("the committed README matches the lockstep package version", async () => {
    const root = join(import.meta.dir, "../..");
    const pkg = JSON.parse(
      await readFile(join(root, "packages/strata-core/package.json"), "utf8"),
    ) as {
      version: string;
    };
    const committed = await readFile(join(root, "README.md"), "utf8");
    expect(committed).toContain(`Published as **${pkg.version}**:`);
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

describe("bump workspace install contract", () => {
  test("a major bump updates CLI peers and leaves frozen install/dedupe stable", async () => {
    const root = await mkdtemp(join(tmpdir(), "strata-bump-contract-"));
    const names = [
      "strata-core",
      "strata-bootstrap",
      "strata-cli",
      "strata-starter",
      "create-strata",
    ];
    const write = async (path: string, value: string) => {
      await mkdir(join(root, path, ".."), { recursive: true });
      await Bun.write(join(root, path), value);
    };
    const run = async (args: string[]) => {
      const process = Bun.spawn(["bun", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
      ]);
      if (code !== 0) throw new Error(`${args.join(" ")} failed: ${stdout} ${stderr}`);
    };
    try {
      await write(
        "package.json",
        JSON.stringify({
          name: "strata-bump-fixture",
          private: true,
          workspaces: ["packages/*"],
          dependencies: Object.fromEntries(
            names.map((name) => [
              name === "create-strata" ? name : `@getstrata/${name.replace("strata-", "")}`,
              "workspace:*",
            ]),
          ),
        }),
      );
      for (const name of names) {
        const published =
          name === "create-strata" ? name : `@getstrata/${name.replace("strata-", "")}`;
        const peers =
          name === "strata-bootstrap"
            ? { "@getstrata/core": "^1.0.0" }
            : name === "strata-cli"
              ? { "@getstrata/core": "^1.0.0", "@getstrata/bootstrap": "^1.0.0" }
              : {};
        await write(
          `packages/${name}/package.json`,
          JSON.stringify({ name: published, version: "1.0.0", peerDependencies: peers }, null, 2),
        );
        if (name !== "create-strata")
          await write(`packages/${name}/CHANGELOG.md`, `# ${published}\n\n## 1.0.0\n`);
      }
      for (const file of ["scripts/bump.ts", "scripts/bump-version.ts"]) {
        await write(file, await readFile(join(import.meta.dir, "../..", file), "utf8"));
      }
      await write(
        "scripts/verify-package-versions.ts",
        `const EXPECTED: Record<string, string> = {\n  "@getstrata/core": "1.0.0",\n};`,
      );
      await write("README.md", "Published as **1.0.0**");
      for (const file of [
        "packages/strata-starter/templates/package.json",
        "packages/strata-starter/src/renderEnv.ts",
        "tests/unit/cli/starterGenerate.test.ts",
        "tests/unit/cli/starterTemplate.test.ts",
      ]) {
        await write(file, '{"@getstrata/core": "^1.0.0"}');
      }
      await run(["install", "--ignore-scripts"]);
      await run(["scripts/bump.ts", "2.0.0"]);
      const cli = await Bun.file(join(root, "packages/strata-cli/package.json")).json();
      expect(cli.peerDependencies).toEqual({
        "@getstrata/core": "^2.0.0",
        "@getstrata/bootstrap": "^2.0.0",
      });
      const lock = await readFile(join(root, "bun.lock"), "utf8");
      expect(lock).not.toContain('"^1.0.0"');
      await run(["install", "--frozen-lockfile", "--ignore-scripts"]);
      await run(["dedupe"]);
      expect(await readFile(join(root, "bun.lock"), "utf8")).toBe(lock);
      await run(["scripts/bump.ts", "2.0.0"]);
      expect(await readFile(join(root, "bun.lock"), "utf8")).toBe(lock);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});
