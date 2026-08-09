#!/usr/bin/env bun
import { execSync } from "node:child_process";

const PACKAGES = [
  "@getstrata/core",
  "@getstrata/bootstrap",
  "@getstrata/cli",
  "@getstrata/starter",
];

function run(command: string): string {
  return execSync(command, { encoding: "utf8" }).trim();
}

function listVersions(name: string): string[] {
  try {
    const raw = run(`npm view ${name} versions --json`);
    const parsed = JSON.parse(raw) as string | string[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function keepVersion(version: string): boolean {
  return version === "1.0.0" || version.startsWith("1.");
}

for (const name of PACKAGES) {
  for (const version of listVersions(name)) {
    if (keepVersion(version)) {
      continue;
    }
    const spec = `${name}@${version}`;
    try {
      execSync(`npm unpublish ${spec} --force`, { stdio: "inherit" });
      console.log(`Unpublished ${spec}`);
    } catch {
      try {
        execSync(`npm deprecate ${spec} "Use ${name}@1.0.0."`, { stdio: "inherit" });
        console.log(`Deprecated ${spec}`);
      } catch {
        console.warn(`Could not remove ${spec}`);
      }
    }
  }
}
