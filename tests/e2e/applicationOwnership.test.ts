import { test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidatePackage } from "../../scripts/candidate-packages";

async function run(args: string[], cwd: string) {
  const child = Bun.spawn(args, {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(exitCode, 0, `${args[0]} failed (${exitCode})\n${stdout}\n${stderr}`);
  return stdout;
}

test("packed public application consumer owns real HTTP/command work and ignored late failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strata-application-owner-"));
  try {
    const archive = await candidatePackage("core", directory);
    const archiveSha256 = createHash("sha256")
      .update(await readFile(archive))
      .digest("hex");
    const installed = join(directory, "node_modules/@getstrata/core");
    await mkdir(installed, { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    // Exercise the actual archive/export layout without source aliases or workspace symlinks.
    // This narrow kernel has no external runtime dependency; full dependency installation
    // remains covered by the existing package/generated-consumer gates.
    await run(["tar", "-xzf", archive, "--strip-components=1", "-C", installed], directory);
    for (const file of ["applicationOwnershipConsumer.ts", "applicationOwnershipSupport.ts"]) {
      await copyFile(join(import.meta.dir, "../fixtures", file), join(directory, file));
    }
    const reports = [];
    for (const mode of ["packed", "ignored-failures", "pending-stop"]) {
      const stdout = await run(
        [process.execPath, "applicationOwnershipConsumer.ts", mode],
        directory,
      );
      const report = JSON.parse(stdout.trim());
      assert.equal(report.mode, mode);
      reports.push(report);
    }
    console.log(JSON.stringify({ archiveSha256, reports }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 45000);
