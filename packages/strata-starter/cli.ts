#!/usr/bin/env bun
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const PLACEHOLDER = /\{\{PROJECT_NAME\}\}/g;

interface Options {
  projectName: string;
  targetDir: string;
}

function usage() {
  console.log(`Usage: create-strata [project-name]

Scaffold a new Strata application with Bun, @getstrata/core, and @getstrata/bootstrap.

Examples:
  bunx @getstrata/starter my-app
  bunx create-strata my-app
`);
}

function parseArgs(argv: string[]): Options | null {
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  if (argv.includes("-h") || argv.includes("--help")) {
    usage();
    process.exit(0);
  }

  const projectName = positional[0] ?? "strata-app";
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(projectName)) {
    console.error("Project name must contain only letters, numbers, hyphens, and underscores.");
    process.exit(1);
  }

  return {
    projectName,
    targetDir: resolve(process.cwd(), projectName),
  };
}

function copyTemplate(source: string, target: string, projectName: string) {
  mkdirSync(target, { recursive: true });

  for (const entry of readdirSync(source)) {
    const from = join(source, entry);
    const to = join(target, entry.replace(PLACEHOLDER, projectName));
    const info = statSync(from);

    if (info.isDirectory()) {
      copyTemplate(from, to, projectName);
      continue;
    }

    let contents = readFileSync(from, "utf8");
    if (contents.includes("{{PROJECT_NAME}}")) {
      contents = contents.replace(PLACEHOLDER, projectName);
    }
    writeFileSync(to, contents, { mode: info.mode & 0o777 });
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) process.exit(1);

  const templateDir = join(import.meta.dir, "templates");
  if (!existsSync(templateDir)) {
    console.error("Template directory missing. Reinstall create-strata.");
    process.exit(1);
  }

  if (existsSync(options.targetDir)) {
    console.error(`Directory already exists: ${options.targetDir}`);
    process.exit(1);
  }

  copyTemplate(templateDir, options.targetDir, options.projectName);

  console.log(`\nCreated Strata app in ${options.projectName}/\n`);
  console.log("Next steps:");
  console.log(`  cd ${options.projectName}`);
  console.log("  cp .env.example .env");
  console.log("  docker compose up -d");
  console.log("  bun install");
  console.log("  strata migrate");
  console.log("  strata dev\n");
}

main();
