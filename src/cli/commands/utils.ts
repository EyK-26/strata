import { mkdir } from "node:fs/promises";
import { join } from "node:path";

function toKebabCase(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function toPascalCase(value: string): string {
  return toKebabCase(value)
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");
}

function toCamelCase(value: string): string {
  const pascalCase = toPascalCase(value);
  return pascalCase[0]?.toLowerCase() + pascalCase.slice(1);
}

function timestampForFilename(date: Date = new Date()): string {
  const parts = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
    String(date.getUTCSeconds()).padStart(2, "0"),
  ];

  return parts.join("");
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

function moduleDirectory(name: string): string {
  return join(import.meta.dir, "..", "..", "modules", toKebabCase(name));
}

function migrationDirectory(): string {
  return join(import.meta.dir, "..", "..", "db", "migrations");
}

export {
  ensureDirectory,
  migrationDirectory,
  moduleDirectory,
  timestampForFilename,
  toCamelCase,
  toKebabCase,
  toPascalCase,
};
