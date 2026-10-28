import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RELEASE_PACKAGES } from "./release-packages.ts";
import {
  checkReleaseReadiness,
  type PackageVersion,
  type ReleaseReadiness,
} from "./release-readiness.ts";
import { parseStableVersion } from "./stable-version.ts";

function checkBuildReleaseReadiness(packages: readonly PackageVersion[]): ReleaseReadiness {
  const channel = parseStableVersion(packages[0]?.version ?? "") !== null ? "stable" : "next";
  const result = checkReleaseReadiness({ packages, channel });
  if (
    packages.length !== RELEASE_PACKAGES.length ||
    RELEASE_PACKAGES.some(([name], index) => packages[index]?.name !== name)
  )
    result.errors.push("Build metadata must identify all five release packages in order.");
  return result;
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  const packages: PackageVersion[] = [];
  for (const [, directory] of RELEASE_PACKAGES)
    packages.push(
      JSON.parse(await readFile(join(root, directory, "package.json"), "utf8")) as PackageVersion,
    );
  const result = checkBuildReleaseReadiness(packages);
  if (result.errors.length) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `Build release metadata ready: ${packages.length} packages at ${result.version}. No publication was authorized.`,
    );
}

export { checkBuildReleaseReadiness };
