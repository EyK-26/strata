#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchPublishedVersions } from "./published-package-versions.ts";
import { takeReleaseChannel } from "./release-channel-options.ts";
import { RELEASE_PACKAGES } from "./release-packages.ts";
import {
  checkReleaseReadiness,
  checkReleaseTarget,
  type PackageVersion,
  resolveLockstepVersion,
} from "./release-readiness.ts";

const ROOT = join(import.meta.dir, "..");

const PACKAGE_FILES = RELEASE_PACKAGES.map(([, directory]) => `${directory}/package.json`);

const { args, channel } = takeReleaseChannel(process.argv.slice(2));
const checkNpm = args.includes("--check-npm");
const tag = args.find((arg) => !arg.startsWith("--"));
const skipTarget = args.includes("--no-target-check");
const targetRef =
  args.find((arg) => arg.startsWith("--ref="))?.slice("--ref=".length) ?? "origin/main";

const packages: PackageVersion[] = [];
for (const relativePath of PACKAGE_FILES) {
  const parsed = JSON.parse(await readFile(join(ROOT, relativePath), "utf8")) as PackageVersion;
  packages.push({
    name: parsed.name,
    version: parsed.version,
    peerDependencies: parsed.peerDependencies,
  });
}

let publishedVersions: string[] | undefined;
if (checkNpm) {
  const perPackage = await Promise.all(packages.map((entry) => fetchPublishedVersions(entry.name)));
  publishedVersions = perPackage.flat();
}

async function git(gitArgs: string[]): Promise<string | null> {
  const proc = Bun.spawn(["git", ...gitArgs], { cwd: ROOT, stdout: "pipe", stderr: "ignore" });
  const [text, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return exitCode === 0 ? text.trim() : null;
}

async function readVersionsAt(ref: string): Promise<PackageVersion[] | null> {
  const entries: PackageVersion[] = [];

  for (const relativePath of PACKAGE_FILES) {
    const raw = await git(["show", `${ref}:${relativePath}`]);

    if (raw === null) {
      return null;
    }

    entries.push(JSON.parse(raw) as PackageVersion);
  }

  return entries;
}

const targetErrors: string[] = [];

if (tag !== undefined && !skipTarget) {
  const refPackages = await readVersionsAt(targetRef);
  const headOnRef = (await git(["merge-base", "--is-ancestor", "HEAD", targetRef])) !== null;

  targetErrors.push(
    ...checkReleaseTarget({
      ref: targetRef,
      refResolved: refPackages !== null,
      refVersion:
        refPackages === null ? null : resolveLockstepVersion(refPackages, channel).version,
      workingTreeVersion: resolveLockstepVersion(packages, channel).version,
      headOnRef,
    }),
  );
}

const result = checkReleaseReadiness({ packages, tag, publishedVersions, channel });

const allErrors = [...result.errors, ...targetErrors];

if (allErrors.length > 0) {
  console.error(`Release readiness failed:\n${allErrors.map((e) => `- ${e}`).join("\n")}`);
  process.exit(1);
}

console.log(
  tag
    ? `Release ready: ${packages.length} packages at ${result.version} on ${targetRef}, matching ${tag}.`
    : `Release ready: ${packages.length} packages at ${result.version}. Tag this commit v${result.version}.`,
);
