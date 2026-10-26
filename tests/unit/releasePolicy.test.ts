import { describe, expect, test } from "bun:test";
import { PACKAGE_JSON_FILES } from "../../scripts/bump.ts";
import { RELEASE_PACKAGES } from "../../scripts/release-packages.ts";
import {
  compareReleaseVersions,
  resolveReleasePolicy,
  resolveReleaseTagPolicy,
} from "../../scripts/release-policy.ts";

describe("explicit release channel policy", () => {
  test("the pure release matrix retains the standalone stable bump coordinates", () => {
    expect(RELEASE_PACKAGES.map(([, directory]) => `${directory}/package.json`)).toEqual(
      PACKAGE_JSON_FILES,
    );
  });
  test("stable policy retains its channel and scaffold defaults", () => {
    expect(resolveReleasePolicy("2.2.59")).toEqual({
      version: "2.2.59",
      tag: "v2.2.59",
      channel: "stable",
      npmTag: "latest",
      github: {},
      containerAliases: ["latest"],
      dependencyPin: "^2.2.59",
    });
  });

  for (const version of [
    "0.0.0-alpha.0",
    "3.0.0-beta.10",
    "3.0.0-rc.0",
    "9007199254740991.0.0-alpha.9007199254740991",
  ]) {
    test(`next policy isolates ${version} from stable pointers`, () => {
      expect(resolveReleasePolicy(version, "next")).toEqual({
        version,
        tag: `v${version}`,
        channel: "next",
        npmTag: "next",
        github: { prerelease: true, makeLatest: false },
        containerAliases: [],
        dependencyPin: version,
      });
    });
  }

  for (const version of [
    "3.0.0",
    "03.0.0-alpha.1",
    "3.00.0-alpha.1",
    "3.0.00-alpha.1",
    "3.0.0-alpha.01",
    "3.0.0-alpha.-1",
    "3.0.0-alpha.1.2",
    "3.0.0-alpha",
    "3.0.0-dev.1",
    "3.0.0-ALPHA.1",
    "3.0.0-alpha.1+build",
    "3.0.0-alpha.1\n",
    " 3.0.0-alpha.1",
    "3.0.0-alpha.9007199254740992",
    "9007199254740992.0.0-alpha.1",
  ]) {
    test(`refuses unsupported next metadata ${JSON.stringify(version)}`, () => {
      expect(() => resolveReleasePolicy(version, "next")).toThrow("release policy");
    });
  }

  test("neither a default channel nor an unknown channel can reinterpret a candidate", () => {
    expect(() => resolveReleasePolicy("3.0.0-alpha.1")).toThrow("release policy");
    expect(() => resolveReleasePolicy("3.0.0-alpha.1", "latest")).toThrow("release policy");
    expect(() => resolveReleasePolicy("3.0.0", "next")).toThrow("release policy");
  });

  test("workflow tags must be canonical and match an explicit channel", () => {
    expect(resolveReleaseTagPolicy("v3.0.0-alpha.1", "next").version).toBe("3.0.0-alpha.1");
    for (const tag of ["3.0.0-alpha.1", " v3.0.0-alpha.1", "v3.0.0-alpha.1\n", "v3.0.0"]) {
      expect(() => resolveReleaseTagPolicy(tag, "next")).toThrow("release policy");
    }
    expect(() => resolveReleaseTagPolicy("v3.0.0-alpha.1", "stable")).toThrow("release policy");
  });

  test("native ordering follows validated numeric and phase precedence", () => {
    const sequence = [
      "2.2.59",
      "3.0.0-alpha.0",
      "3.0.0-alpha.2",
      "3.0.0-alpha.10",
      "3.0.0-beta.0",
      "3.0.0-rc.0",
      "3.0.0",
    ];
    for (let i = 1; i < sequence.length; i++) {
      const left = sequence[i - 1] ?? "";
      const right = sequence[i] ?? "";
      expect(compareReleaseVersions(left, right)).toBe(-1);
      expect(compareReleaseVersions(right, left)).toBe(1);
      expect(compareReleaseVersions(right, right)).toBe(0);
    }
    expect(() => compareReleaseVersions("03.0.0-alpha.0", "3.0.0")).toThrow("release policy");
  });
});
