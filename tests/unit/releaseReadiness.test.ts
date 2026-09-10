import { describe, expect, test } from "bun:test";
import {
  checkReleaseReadiness,
  checkReleaseTarget,
  type PackageVersion,
  parseReleaseTag,
  resolveLockstepVersion,
} from "../../scripts/release-readiness.ts";

const FIVE = (version: string): PackageVersion[] =>
  [
    "@getstrata/core",
    "@getstrata/bootstrap",
    "@getstrata/cli",
    "@getstrata/starter",
    "create-strata",
  ].map((name) => ({ name, version }));

describe("parseReleaseTag", () => {
  test("accepts a v-prefixed semver core and returns the bare version", () => {
    expect(parseReleaseTag("v1.0.6")).toBe("1.0.6");
    expect(parseReleaseTag("  v10.20.30  ")).toBe("10.20.30");
  });

  test("rejects anything that is not a release tag", () => {
    for (const tag of ["1.0.6", "v1.0", "release-1.0.6", "v1.0.6-rc.1", "", "vX.Y.Z"]) {
      expect(parseReleaseTag(tag)).toBeNull();
    }
  });
});

describe("resolveLockstepVersion", () => {
  test("returns the shared version when every package agrees", () => {
    expect(resolveLockstepVersion(FIVE("1.0.6"))).toEqual({ version: "1.0.6", errors: [] });
  });

  test("names the drifting packages when versions disagree", () => {
    const packages = [...FIVE("1.0.6")];
    packages[2] = { name: "@getstrata/cli", version: "1.0.5" };

    const result = resolveLockstepVersion(packages);

    expect(result.version).toBeNull();
    expect(result.errors[0]).toContain("not in lockstep");
    expect(result.errors[0]).toContain("1.0.5: @getstrata/cli");
  });

  test("rejects an empty or blank version", () => {
    expect(resolveLockstepVersion([{ name: "a", version: " " }]).errors[0]).toContain(
      "Missing version for a",
    );
  });

  test("rejects an empty package set rather than reporting success", () => {
    expect(resolveLockstepVersion([]).errors).toEqual(["No packages were checked."]);
  });
});

describe("checkReleaseTarget", () => {
  const base = {
    ref: "origin/main",
    refResolved: true,
    refVersion: "1.0.7",
    workingTreeVersion: "1.0.7",
    headOnRef: true,
  };

  test("passes when the ref and the working tree agree and HEAD is merged", () => {
    expect(checkReleaseTarget(base)).toEqual([]);
  });

  test("reproduces the v1.0.6 incident: bump not merged yet", () => {
    const errors = checkReleaseTarget({ ...base, refVersion: "1.0.6", headOnRef: false });

    expect(errors[0]).toContain("origin/main is at 1.0.6 but this working tree is at 1.0.7");
    expect(errors[0]).toContain("would publish 1.0.6");
    expect(errors[1]).toContain("HEAD is not contained in origin/main");
  });

  test("flags an unmerged HEAD even when the versions happen to match", () => {
    const errors = checkReleaseTarget({ ...base, headOnRef: false });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("HEAD is not contained");
  });

  test("tells you to fetch when the ref cannot be read", () => {
    const errors = checkReleaseTarget({ ...base, refResolved: false });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("git fetch origin main");
  });

  test("reports drift on the ref itself", () => {
    const errors = checkReleaseTarget({ ...base, refVersion: null });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("not in lockstep");
  });

  test("names whichever ref was checked", () => {
    const errors = checkReleaseTarget({ ...base, ref: "upstream/release", refResolved: false });

    expect(errors[0]).toContain("upstream/release");
  });
});

describe("checkReleaseReadiness", () => {
  test("reports the releasable version when no tag is supplied", () => {
    const result = checkReleaseReadiness({ packages: FIVE("1.0.6") });
    expect(result).toEqual({ version: "1.0.6", errors: [] });
  });

  test("accepts a tag that matches every package", () => {
    expect(checkReleaseReadiness({ packages: FIVE("1.0.6"), tag: "v1.0.6" }).errors).toEqual([]);
  });

  test("reproduces the v1.0.6 incident: tag ahead of package.json is refused", () => {
    const result = checkReleaseReadiness({ packages: FIVE("1.0.5"), tag: "v1.0.6" });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Tag v1.0.6 does not match the package version 1.0.5");
  });

  test("refuses a malformed tag", () => {
    expect(checkReleaseReadiness({ packages: FIVE("1.0.6"), tag: "1.0.6" }).errors[0]).toContain(
      "is not a release tag",
    );
  });

  test("refuses re-tagging a version that is already on npm", () => {
    const result = checkReleaseReadiness({
      packages: FIVE("1.0.6"),
      tag: "v1.0.6",
      publishedVersions: ["1.0.4", "1.0.5", "1.0.6"],
    });

    expect(result.errors[0]).toContain("already published");
  });

  test("allows an unpublished version through the npm check", () => {
    const result = checkReleaseReadiness({
      packages: FIVE("1.0.7"),
      tag: "v1.0.7",
      publishedVersions: ["1.0.5", "1.0.6"],
    });

    expect(result.errors).toEqual([]);
  });

  test("does not invent a tag error when lockstep already failed", () => {
    const packages = [...FIVE("1.0.6")];
    packages[0] = { name: "@getstrata/core", version: "1.0.5" };

    const result = checkReleaseReadiness({ packages, tag: "v1.0.6" });

    expect(result.version).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("not in lockstep");
  });
});
