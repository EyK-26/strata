import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FrontendMode } from "../../config/frontend";

const TEMPLATE_ROOT = join(import.meta.dir, "../../../templates/scaffold");

type ScaffoldTemplate = FrontendMode;

function parseFrontendMode(value: string | undefined): FrontendMode {
  if (value === "server-htmx") {
    return "server-htmx";
  }

  if (value === "spa-react") {
    return "spa-react";
  }

  return "api";
}

function parseTemplateMode(value: string | undefined): ScaffoldTemplate {
  return parseFrontendMode(value);
}

function parseArgs(args: string[]): { template: ScaffoldTemplate; envPath: string } {
  let template: ScaffoldTemplate = "api";
  let envPath = join(process.cwd(), ".env");

  for (const arg of args) {
    if (arg.startsWith("--frontend=")) {
      template = parseFrontendMode(arg.slice("--frontend=".length));
      continue;
    }

    if (arg.startsWith("--template=")) {
      template = parseTemplateMode(arg.slice("--template=".length));
      continue;
    }

    if (arg.startsWith("--env=")) {
      envPath = join(process.cwd(), arg.slice("--env=".length));
    }
  }

  return { template, envPath };
}

async function upsertEnvValue(envPath: string, key: string, value: string): Promise<void> {
  const line = `${key}=${value}`;
  const sourcePath = existsSync(envPath) ? envPath : join(process.cwd(), ".env.example");
  const contents = existsSync(sourcePath) ? await readFile(sourcePath, "utf8") : "";
  const pattern = new RegExp(`^${key}=.*$`, "m");

  if (pattern.test(contents)) {
    await writeFile(envPath, contents.replace(pattern, line));
    return;
  }

  const separator = contents.length > 0 && !contents.endsWith("\n") ? "\n" : "";
  await writeFile(envPath, `${contents}${separator}${line}\n`);
}

async function copyTemplateTree(sourceRoot: string, targetRoot: string): Promise<void> {
  const { readdirSync } = await import("node:fs");

  if (!existsSync(sourceRoot)) {
    return;
  }

  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    const sourcePath = join(sourceRoot, entry.name);
    const targetPath = join(targetRoot, entry.name);

    if (entry.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      await copyTemplateTree(sourcePath, targetPath);
      continue;
    }

    if (existsSync(targetPath)) {
      continue;
    }

    await mkdir(join(targetPath, ".."), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }
}

async function newCommand(...args: string[]): Promise<void> {
  const { template, envPath } = parseArgs(args);

  if (template === "server-htmx") {
    await copyTemplateTree(join(TEMPLATE_ROOT, "server-htmx"), process.cwd());
  }

  if (template === "spa-react") {
    await copyTemplateTree(join(TEMPLATE_ROOT, "spa-react"), process.cwd());
  }

  if (template === "api") {
    await copyTemplateTree(join(TEMPLATE_ROOT, "api"), process.cwd());
  }

  await upsertEnvValue(envPath, "FRONTEND_MODE", template);

  console.log(`Frontend mode set to "${template}" in ${envPath}.`);

  if (template === "server-htmx") {
    console.log("Server pages enabled:");
    console.log("- resources/views/ (Eta templates with CSRF + flash)");
    console.log("- public/assets/ (static CSS)");
    console.log("- Sample organization CRUD views under resources/views/organizations/");
    console.log("- Web routes via module webRoutes()");
    console.log("\nRestart the app after changing FRONTEND_MODE.");
    return;
  }

  if (template === "spa-react") {
    console.log("SPA mode enabled:");
    console.log("- frontend/ (Vite + React scaffold with sample CRUD pages)");
    console.log("- Dev: cd frontend && bun install && bun run dev");
    console.log("- Prod: cd frontend && bun run build, then serve /app/* from dist");
    console.log("\nRestart the API app after changing FRONTEND_MODE.");
    return;
  }

  console.log("API-only mode enabled. Web routes and view rendering are disabled.");
  console.log("- See docs/API.md scaffold notes from templates/scaffold/api/");
}

export { newCommand, parseFrontendMode, parseTemplateMode };
