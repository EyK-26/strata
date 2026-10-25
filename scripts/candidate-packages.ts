import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PARTS = ["core", "bootstrap", "cli"] as const;
type Part = (typeof PARTS)[number];
type Archive = { file: string; sha256: string; manifestSha256: string };
type ArchiveManifest = { version: 1; root: string; archives: Record<Part, Archive> };
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function packCandidate(part: Part, destination: string): Promise<string> {
  const child = Bun.spawn(["npm", "pack", "--silent", "--pack-destination", destination], {
    cwd: join(ROOT, `packages/strata-${part}`),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(exitCode, 0, `Candidate ${part} pack failed: ${stdout}\n${stderr}`);
  const file = stdout.trim().split("\n").at(-1);
  assert.ok(file && file === basename(file) && file.endsWith(".tgz"), `Invalid ${part} tarball`);
  return join(destination, file);
}

/** One immutable archive set per E2E invocation, never a persistent cross-commit cache. */
async function prepareCandidatePackages(directory: string): Promise<void> {
  const archives = {} as Record<Part, Archive>;
  for (const part of PARTS) {
    const file = await packCandidate(part, directory);
    archives[part] = {
      file: basename(file),
      sha256: digest(await readFile(file)),
      manifestSha256: digest(await readFile(join(ROOT, `packages/strata-${part}/package.json`))),
    };
    await chmod(file, 0o444);
  }
  const manifest: ArchiveManifest = { version: 1, root: await realpath(ROOT), archives };
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest), {
    flag: "wx",
    mode: 0o444,
  });
}

async function candidatePackage(part: Part, destination: string): Promise<string> {
  const directory = process.env.STRATA_TEST_PACKAGE_DIR;
  if (!directory) return packCandidate(part, destination);
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  ) as ArchiveManifest;
  assert.equal(manifest.version, 1, "Unsupported candidate archive manifest");
  assert.equal(
    manifest.root,
    await realpath(ROOT),
    "Candidate archives belong to another checkout",
  );
  const archive = manifest.archives[part];
  assert.ok(archive && archive.file === basename(archive.file) && archive.file.endsWith(".tgz"));
  assert.equal(
    archive.manifestSha256,
    digest(await readFile(join(ROOT, `packages/strata-${part}/package.json`))),
    "Package changed during acceptance",
  );
  const file = join(directory, archive.file);
  assert.equal(
    digest(await readFile(file)),
    archive.sha256,
    "Candidate archive changed during acceptance",
  );
  return file;
}

export { candidatePackage, prepareCandidatePackages };
