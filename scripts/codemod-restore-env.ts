#!/usr/bin/env bun
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const TEST_ROOT = join(ROOT, "tests");

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
      continue;
    }

    if (entry.name.endsWith(".test.ts")) {
      files.push(path);
    }
  }

  return files;
}

const restorePattern = /process\.env\.([A-Z0-9_]+)\s*=\s*previous([A-Za-z0-9_]*);/g;

for (const file of await walk(TEST_ROOT)) {
  if (file.endsWith("providers.test.ts")) {
    continue;
  }

  let source = await readFile(file, "utf8");

  if (!restorePattern.test(source)) {
    continue;
  }

  restorePattern.lastIndex = 0;

  if (!source.includes("restoreEnvVar")) {
    const importPath = file.includes("/integration/")
      ? "../helpers/restoreEnv"
      : file.includes("/unit/cli/")
        ? "../../helpers/restoreEnv"
        : "../helpers/restoreEnv";

    source = source.replace(
      /^(import .+\n)+/,
      (block) => `${block}import { restoreEnvVar } from "${importPath}";\n`,
    );
  }

  source = source.replace(restorePattern, 'restoreEnvVar("$1", previous$2);');

  await writeFile(file, source);
  console.log("updated", file.replace(`${ROOT}/`, ""));
}

console.log("restoreEnvVar codemod complete");
