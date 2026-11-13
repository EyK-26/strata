import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CandidatePackageOwnershipError } from "../../../scripts/candidate-packages";
import { StarterQualificationRoot } from "../../../scripts/starter-qualification-root";

test("unresolved pack child retains archives even with no profile command children", async () => {
  const root = await mkdtemp(join(tmpdir(), "pairwise-pack-owner-"));
  const marker = join(root, "archive-being-written");
  await writeFile(marker, "owned");
  const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const owner = new StarterQualificationRoot(root);
  const failure = new CandidatePackageOwnershipError(
    [new Error("exit observer failed")],
    root,
    child,
  );
  try {
    await expect(
      owner.prepare(root, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await owner.cleanup(false)).toBe("retained");
    expect(existsSync(marker)).toBe(true);
    expect(child.exitCode).toBeNull();
  } finally {
    child.kill("SIGTERM");
    await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    await rm(root, { recursive: true, force: true });
  }
});

test("confirmed preparation failure removes only its owned root", async () => {
  const root = await mkdtemp(join(tmpdir(), "pairwise-pack-confirmed-"));
  const owner = new StarterQualificationRoot(root);
  await expect(
    owner.prepare(root, async () => {
      throw new Error("packer exited nonzero");
    }),
  ).rejects.toThrow("packer exited nonzero");
  expect(await owner.cleanup(false)).toBe("removed");
  expect(existsSync(root)).toBe(false);
});
