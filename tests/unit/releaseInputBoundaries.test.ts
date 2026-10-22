import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareVersions, parseVersion } from "../../scripts/bump-version.ts";
import { fetchPublishedVersions } from "../../scripts/published-package-versions.ts";
import { checkReleaseReadiness, parseReleaseTag } from "../../scripts/release-readiness.ts";

const root = join(import.meta.dir, "../..");
const names = [
  "@getstrata/core",
  "@getstrata/bootstrap",
  "@getstrata/cli",
  "@getstrata/starter",
  "create-strata",
];
const invalid = [
  "03.0.0",
  "3.00.0",
  "3.0.00",
  "9007199254740992.0.0",
  "3.9007199254740993.0",
  "3.0.9007199254740993",
];

describe("canonical stable release inputs", () => {
  for (const version of invalid) {
    test(`refuses ${version} in every stable release adapter`, () => {
      expect(parseVersion(version)).toBeNull();
      expect(parseReleaseTag(`v${version}`)).toBeNull();
      expect(() => compareVersions(version, "3.0.0")).toThrow("Not a semver version");
      for (const tag of [undefined, `v${version}`]) {
        const result = checkReleaseReadiness({
          packages: names.map((name) => ({ name, version })),
          tag,
        });
        expect(result.version).toBeNull();
        expect(result.errors.join(" ")).toContain("canonical stable version");
      }
    });
  }

  test("retains exact safe tuples, zero and supported CLI whitespace", () => {
    expect(parseVersion("0.0.0")).toEqual([0, 0, 0]);
    expect(parseVersion(" 10.20.30 ")).toEqual([10, 20, 30]);
    expect(parseVersion("9007199254740991.0.0")).toEqual([Number.MAX_SAFE_INTEGER, 0, 0]);
    expect(compareVersions("9007199254740991.0.0", "9007199254740990.0.0")).toBe(1);
    expect(parseReleaseTag(" v10.20.30 ")).toBe("10.20.30");
  });

  for (const version of [" 3.0.0 ", "3.0.0\n", "3.0.0\r\n"]) {
    test(`package metadata itself must be canonical: ${JSON.stringify(version)}`, () => {
      const result = checkReleaseReadiness({ packages: names.map((name) => ({ name, version })) });
      expect(result.version).toBeNull();
      expect(result.errors.join(" ")).toContain("canonical stable version");
    });
  }

  test("actual read-only bump CLI rejects invalid pins and normalizes outer whitespace", async () => {
    const manifest = join(root, "packages/strata-core/package.json");
    const before = await readFile(manifest, "utf8");
    for (const version of invalid) {
      const result = Bun.spawnSync([process.execPath, "scripts/bump.ts", version, "--check"], {
        cwd: root,
      });
      expect(result.exitCode, version).toBe(1);
      expect(result.stderr.toString()).toContain("Usage:");
    }
    const current = JSON.parse(before).version as string;
    const result = Bun.spawnSync([process.execPath, "scripts/bump.ts", ` ${current} `, "--check"], {
      cwd: root,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain(`every file already targets ${current}.`);
    expect(await readFile(manifest, "utf8")).toBe(before);
  });
});

describe("authoritative npm version lookup", () => {
  const name = "@getstrata/core";
  test("keeps stable and prerelease keys from successful package metadata", async () => {
    const versions = await fetchPublishedVersions(name, async (url) => {
      expect(url).toBe(`https://registry.npmjs.org/${name}`);
      return Response.json({ name, versions: { "2.2.49": {}, "3.0.0-alpha.1": {} } });
    });
    expect(versions).toEqual(["2.2.49", "3.0.0-alpha.1"]);
  });
  test("accepts an authoritative empty version map", async () => {
    expect(
      await fetchPublishedVersions(name, async () => Response.json({ name, versions: {} })),
    ).toEqual([]);
  });
  for (const status of [404, 429, 500]) {
    test(`refuses unknown registry state on HTTP ${status}`, async () => {
      await expect(
        fetchPublishedVersions(name, async () => new Response("unavailable", { status })),
      ).rejects.toThrow(name);
    });
  }
  test("refuses a network rejection rather than reporting an unused version", async () => {
    await expect(
      fetchPublishedVersions(name, async () => {
        throw new Error("fixture network failure");
      }),
    ).rejects.toThrow(name);
  });
  test("refuses malformed JSON", async () => {
    await expect(fetchPublishedVersions(name, async () => new Response("{"))).rejects.toThrow(name);
  });
  for (const metadata of [
    null,
    [],
    {},
    { name },
    { name, versions: null },
    { name, versions: [] },
    { name, versions: "versions" },
    { name: "another-package", versions: {} },
  ]) {
    test(`refuses malformed package metadata ${JSON.stringify(metadata)}`, async () => {
      await expect(
        fetchPublishedVersions(name, async () => Response.json(metadata)),
      ).rejects.toThrow(name);
    });
  }
  test("actual readiness CLI fails closed before printing ready on registry failure", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "strata-registry-boundary-"));
    try {
      const preload = join(fixture, "registry.ts");
      await writeFile(
        preload,
        'globalThis.fetch = (async () => new Response("fixture registry unavailable", { status: 503 })) as typeof fetch;\n',
      );
      const result = Bun.spawnSync(
        [process.execPath, "--preload", preload, "scripts/verify-release-ready.ts", "--check-npm"],
        { cwd: root },
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("registry");
      expect(result.stdout.toString()).not.toContain("Release ready:");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
