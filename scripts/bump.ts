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
  "packages/strata-bootstrap/package.json",
  "packages/strata-starter/templates/package.json",
  "packages/strata-starter/src/renderEnv.ts",
  "tests/unit/cli/starterGenerate.test.ts",
  "tests/unit/cli/starterTemplate.test.ts",
];

const EXPECTED_FILE = "scripts/verify-package-versions.ts";

const CHANGELOGS = [
  "packages/strata-core/CHANGELOG.md",
  "packages/strata-bootstrap/CHANGELOG.md",
  "packages/strata-cli/CHANGELOG.md",
  "packages/strata-starter/CHANGELOG.md",
];

const args = process.argv.slice(2);
const check = args.includes("--check");
const notesIndex = args.indexOf("--notes");
const notes = notesIndex === -1 ? "" : (args[notesIndex + 1] ?? "");
const version = args.find((arg) => !arg.startsWith("--") && arg !== notes);

if (!version || !parseVersion(version)) {
  console.error('Usage: bun run bump <major.minor.patch> [--check] [--notes "..."]');
  process.exit(1);
}

const current = (
  JSON.parse(await readFile(join(ROOT, PACKAGE_JSON_FILES[0] ?? ""), "utf8")) as {
    version: string;
  }
).version;

if (compareVersions(version, current) < 0) {
  console.error(`Refusing to bump: ${version} is older than the current ${current}.`);
  process.exit(1);
}

const pending = new Map<string, string>();

async function edit(relativePath: string, transform: (text: string) => string): Promise<void> {
  const absolute = join(ROOT, relativePath);
  const before = pending.get(relativePath) ?? (await readFile(absolute, "utf8"));
  const after = transform(before);

  if (after !== before) {
    pending.set(relativePath, after);
  }
}

for (const file of PACKAGE_JSON_FILES) {
  await edit(file, (text) => setPackageVersion(text, version));
}

for (const file of PIN_FILES) {
  await edit(file, (text) => retargetStrataPins(text, version));
}

await edit(EXPECTED_FILE, (text) => setExpectedVersions(text, version));

for (const file of CHANGELOGS) {
  await edit(file, (text) => insertChangelogEntry(text, version, notes));
}

if (pending.size === 0) {
  console.log(`Nothing to change; every file already targets ${version}.`);
  process.exit(0);
}

if (check) {
  console.log(`bump ${current} -> ${version} would update ${pending.size} file(s):`);
  for (const file of [...pending.keys()].sort()) {
    console.log(`  ${file}`);
  }
  process.exit(0);
}

for (const [file, contents] of pending) {
  await writeFile(join(ROOT, file), contents, "utf8");
}

console.log(`Bumped ${current} -> ${version} across ${pending.size} file(s):`);
for (const file of [...pending.keys()].sort()) {
  console.log(`  ${file}`);
}
console.log(
  notes
    ? `\nNext: bun run release:check v${version}`
    : `\nAdd changelog notes under "## ${version}", then: bun run release:check v${version}`,
);
