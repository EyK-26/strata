import { expect, test } from "bun:test";
import { RELEASE_PACKAGES } from "../../scripts/release-packages.ts";
import type { PackageVersion } from "../../scripts/release-readiness.ts";
import { checkBuildReleaseReadiness } from "../../scripts/verify-build-release.ts";

test("read-only build validation accepts explicit metadata without changing the stable release CLI", () => {
  for (const version of ["2.2.59", "3.0.0-alpha.0"]) {
    const packages = RELEASE_PACKAGES.map(([name]) => ({ name, version }));
    expect(checkBuildReleaseReadiness(packages).errors).toEqual([]);
  }
  for (const version of ["03.0.0-alpha.0", "3.0.0-dev.0", "3.0.0-alpha.01"]) {
    expect(
      checkBuildReleaseReadiness(RELEASE_PACKAGES.map(([name]) => ({ name, version }))).errors
        .length,
    ).toBeGreaterThan(0);
  }
  const packages = RELEASE_PACKAGES.map(
    ([name]): PackageVersion => ({
      name,
      version: "3.0.0-alpha.0",
      peerDependencies:
        name === "@getstrata/bootstrap" ? { "@getstrata/core": "^3.0.0-alpha.0" } : {},
    }),
  );
  expect(checkBuildReleaseReadiness(packages).errors.join(" ")).toContain("exactly");
  expect(checkBuildReleaseReadiness(packages.slice(1)).errors.join(" ")).toContain("five");
});
