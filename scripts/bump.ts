#!/usr/bin/env bun

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compareVersions,
  insertChangelogEntry,
  parseVersion,
  retargetStrataPins,
  setExpectedVersions,
  setPackageVersion,
  setPublishedReadmeVersion,
} from "./bump-version.ts";

const ROOT = join(import.meta.dir, "..");

const PACKAGE_JSON_FILES = [
  "packages/strata-core/package.json",
  "packages/strata-bootstrap/package.json",
  "packages/strata-cli/package.json",
  "packages/strata-starter/package.json",
  "packages/create-strata/package.json",
];

const PIN_FILES = [
  "packages/strata-cli/package.json",
  "packages/strata-bootstrap/package.json",
  "packages/strata-starter/templates/package.json",
  "packages/strata-starter/src/renderProjectMetadata.ts",
  "tests/unit/cli/starterGenerate.test.ts",
  "tests/unit/cli/starterTemplate.test.ts",
];

const EXPECTED_FILE = "scripts/verify-package-versions.ts";
const README_FILE = "README.md";

const CHANGELOGS = [
  "packages/strata-core/CHANGELOG.md",
  "packages/strata-bootstrap/CHANGELOG.md",
  "packages/strata-cli/CHANGELOG.md",
  "packages/strata-starter/CHANGELOG.md",
];

interface BumpTransforms {
  setPackageVersion: (text: string, version: string) => string;
  retargetStrataPins: (text: string, version: string) => string;
  setExpectedVersions: (text: string, version: string) => string;
  setPublishedReadmeVersion: (text: string, version: string) => string;
}

async function readCurrentVersion(root: string): Promise<string> {
  return (
    JSON.parse(await readFile(join(root, PACKAGE_JSON_FILES[0] ?? ""), "utf8")) as {
      version: string;
    }
  ).version;
}

async function buildBumpPlan(
  root: string,
  version: string,
  notes: string,
  transforms: BumpTransforms = {
    setPackageVersion,
    retargetStrataPins,
    setExpectedVersions,
    setPublishedReadmeVersion,
  },
): Promise<Map<string, string>> {
  const pending = new Map<string, string>();
  async function edit(relativePath: string, transform: (text: string) => string): Promise<void> {
    const absolute = join(root, relativePath);
    const before = pending.get(relativePath) ?? (await readFile(absolute, "utf8"));
    const after = transform(before);
    if (after !== before) pending.set(relativePath, after);
  }
  for (const file of PACKAGE_JSON_FILES)
    await edit(file, (text) => transforms.setPackageVersion(text, version));
  for (const file of PIN_FILES)
    await edit(file, (text) => transforms.retargetStrataPins(text, version));
  await edit(EXPECTED_FILE, (text) => transforms.setExpectedVersions(text, version));
  await edit(README_FILE, (text) => transforms.setPublishedReadmeVersion(text, version));
  for (const file of CHANGELOGS)
    await edit(file, (text) => insertChangelogEntry(text, version, notes));
  return pending;
}

async function finishBump(
  root: string,
  current: string,
  version: string,
  pending: Map<string, string>,
  check: boolean,
  notes: string,
): Promise<void> {
  if (pending.size === 0 && check) {
    console.log(`Nothing to change; every file already targets ${version}.`);
    return;
  }
  if (check) {
    console.log(`bump ${current} -> ${version} would update ${pending.size} file(s):`);
    for (const file of [...pending.keys()].sort()) console.log(`  ${file}`);
    return;
  }
  for (const [file, contents] of pending) await writeFile(join(root, file), contents, "utf8");
  // Bun 1.4.2 updates workspace versions before refreshing their peer metadata.
  // Two native install passes settle both; CI's dedupe gate proves consistency.
  for (const command of [
    ["bun", "install", "--ignore-scripts"],
    ["bun", "install", "--ignore-scripts"],
    ["bun", "dedupe"],
  ]) {
    const lockfile = Bun.spawn(command, { cwd: root, stdout: "ignore", stderr: "pipe" });
    const [diagnostics, exitCode] = await Promise.all([
      new Response(lockfile.stderr).text(),
      lockfile.exited,
    ]);
    if (exitCode !== 0) {
      console.error(`Bumped the manifests but ${command.join(" ")} failed:\n${diagnostics}`);
      process.exit(1);
    }
  }
  pending.set("bun.lock", "");
  console.log(`Bumped ${current} -> ${version} across ${pending.size} file(s):`);
  for (const file of [...pending.keys()].sort()) console.log(`  ${file}`);
  console.log(
    notes
      ? `\nNext: bun run release:check v${version}`
      : `\nAdd changelog notes under "## ${version}", then: bun run release:check v${version}`,
  );
}

async function runStableBump(args: string[]): Promise<void> {
  const check = args.includes("--check");
  const notesIndex = args.indexOf("--notes");
  const notes = notesIndex === -1 ? "" : (args[notesIndex + 1] ?? "");
  const version = args.find((arg) => !arg.startsWith("--") && arg !== notes)?.trim();
  if (!version || !parseVersion(version)) {
    console.error('Usage: bun run bump <major.minor.patch> [--check] [--notes "..."]');
    process.exit(1);
  }
  const current = await readCurrentVersion(ROOT);
  if (compareVersions(version, current) < 0) {
    console.error(`Refusing to bump: ${version} is older than the current ${current}.`);
    process.exit(1);
  }
  await finishBump(ROOT, current, version, await buildBumpPlan(ROOT, version, notes), check, notes);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let channelArguments = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--notes") {
      index++;
      continue;
    }
    if (arg === "--promote" || arg === "--channel" || arg.startsWith("--channel=")) {
      channelArguments = true;
      break;
    }
  }
  if (channelArguments) {
    try {
      const { runChannelBump } = await import("./bump-channel.ts");
      await runChannelBump(ROOT, args);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Channel bump failed.");
      process.exitCode = 1;
    }
  } else await runStableBump(args);
}

export type { BumpTransforms };
export { buildBumpPlan, finishBump, PACKAGE_JSON_FILES, readCurrentVersion, runStableBump };
