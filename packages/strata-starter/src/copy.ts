import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const PLACEHOLDER = /\{\{PROJECT_NAME\}\}/g;

function copyTree(
  source: string,
  target: string,
  projectName: string,
  skipNames: ReadonlySet<string> = new Set(),
): void {
  mkdirSync(target, { recursive: true });

  for (const entry of readdirSync(source)) {
    if (skipNames.has(entry) || entry === ".DS_Store") {
      continue;
    }

    const from = join(source, entry);
    const to = join(target, entry.replace(PLACEHOLDER, projectName));
    const info = statSync(from);

    if (info.isDirectory()) {
      copyTree(from, to, projectName, skipNames);
      continue;
    }

    let contents = readFileSync(from, "utf8");
    if (contents.includes("{{PROJECT_NAME}}")) {
      contents = contents.replace(PLACEHOLDER, projectName);
    }
    writeFileSync(to, contents, { mode: info.mode & 0o777 });
  }
}

function copyOverlayTree(sourceRoot: string, targetRoot: string): void {
  if (!existsSync(sourceRoot)) {
    return;
  }

  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    const sourcePath = join(sourceRoot, entry.name);
    const targetPath = join(targetRoot, entry.name);

    if (entry.isDirectory()) {
      mkdirSync(targetPath, { recursive: true });
      copyOverlayTree(sourcePath, targetPath);
      continue;
    }

    if (existsSync(targetPath)) {
      continue;
    }

    mkdirSync(join(targetPath, ".."), { recursive: true });
    const contents = readFileSync(sourcePath);
    writeFileSync(targetPath, contents);
  }
}

function writeText(target: string, contents: string): void {
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, contents.endsWith("\n") ? contents : `${contents}\n`);
}

function removeIfExists(path: string): void {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
}

export { copyOverlayTree, copyTree, removeIfExists, writeText };
