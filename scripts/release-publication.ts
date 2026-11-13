import { readFile } from "node:fs/promises";
import { fetchPublishedVersions } from "./published-package-versions.ts";
import { checkReleaseReadiness } from "./release-readiness.ts";

const releasePackages = [
  "strata-core",
  "strata-bootstrap",
  "strata-cli",
  "strata-starter",
  "create-strata",
];

export function assertReleaseProvenanceSource(
  commit: string,
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (environment.GITHUB_ACTIONS === "true" && environment.GITHUB_SHA !== commit) {
    throw new Error(
      "GitHub provenance source does not match the checked-out release commit. Dispatch this workflow at the release tag ref.",
    );
  }
}

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  if (extra.length || (mode !== "publish" && mode !== "dry-run"))
    throw new Error("Usage: release-publication.ts publish|dry-run");
  const dryRun = mode === "dry-run";
  const source = Bun.spawnSync(["git", "rev-parse", "HEAD"]);
  const commit = source.stdout.toString().trim();
  if (source.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(commit))
    throw new Error("Cannot establish release source commit");
  assertReleaseProvenanceSource(commit, process.env);
  const packages = await Promise.all(
    releasePackages.map(async (name) =>
      JSON.parse(await readFile(`packages/${name}/package.json`, "utf8")),
    ),
  );
  const readiness = checkReleaseReadiness({ packages, tag: process.env.RELEASE_TAG ?? "" });
  if (readiness.errors.length) throw new Error(readiness.errors.join("\n"));

  // All package lookups must succeed before the first publish. Registry failure
  // is not proof that a version is missing. Dry-run never needs registry state.
  const existing = dryRun
    ? packages.map(() => false)
    : await Promise.all(
        packages.map(async (pkg) =>
          (
            await fetchPublishedVersions(pkg.name, (url) =>
              fetch(url, { signal: AbortSignal.timeout(30_000) }),
            )
          ).includes(pkg.version),
        ),
      );
  for (const [index, pkg] of packages.entries()) {
    if (existing[index]) {
      console.log(`Skipping ${pkg.name}@${pkg.version}: already published.`);
      continue;
    }
    const child = Bun.spawn(
      [
        "npm",
        "publish",
        "--workspace",
        pkg.name,
        "--access",
        "public",
        "--tag",
        "latest",
        "--provenance",
        ...(dryRun ? ["--dry-run", "--ignore-scripts"] : []),
      ],
      { stdout: "inherit", stderr: "inherit" },
    );
    if ((await child.exited) !== 0)
      throw new Error(`npm publish failed: ${pkg.name}@${pkg.version}`);
    // npm may acknowledge the upload before public registry metadata catches up.
    // Do not turn propagation delay into a failure or retry an accepted upload.
    console.log(
      `${dryRun ? "Dry-run passed" : "npm accepted publication"}: ${pkg.name}@${pkg.version}`,
    );
  }
}
if (import.meta.main) await main();
