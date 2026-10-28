import { expect, test } from "bun:test";

for (const mode of ["late-commit", "native-close-rejection"]) {
  test(`M1 cleanup deadline with restricted PostgreSQL: ${mode}`, async () => {
    const child = Bun.spawn(
      [process.execPath, "--no-env-file", "run", "tests/fixtures/m1StartupCleanupSql.ts", mode],
      { cwd: process.cwd(), env: process.env, stdout: "pipe", stderr: "pipe", timeout: 20_000 },
    );
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exit, [stdout, stderr].join("\n")).toBe(0);
    const receipt = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");
    expect(receipt.mode).toBe(mode);
    expect(receipt.accepted).toBe(true);
    expect(receipt.restrictedRole).toBe(true);
    expect(receipt.rls).toBe(true);
    expect(receipt.savepointRollback).toBe(true);
    expect(receipt.observerBeforeClose).toBe(true);
    expect(receipt.ownedTableRemoved).toBe(true);
  }, 25_000);
}
