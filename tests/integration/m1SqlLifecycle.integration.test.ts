import { expect, test } from "bun:test";

for (const mode of ["connected", "disconnected", "native-close-rejection"]) {
  test(`M1 restricted PostgreSQL lifecycle: ${mode}`, async () => {
    const child = Bun.spawn(
      [process.execPath, "--no-env-file", "run", "tests/fixtures/m1SqlLifecycle.ts", mode],
      {
        cwd: process.cwd(),
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
        timeout: 20_000,
      },
    );
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exit, `${stdout}\n${stderr}`).toBe(0);
    const receipt = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");
    expect(receipt.mode).toBe(mode);
    expect(receipt.restrictedRole).toBe(true);
    expect(receipt.rls).toBe(true);
    expect(receipt.savepointRollback).toBe(true);
  }, 25_000);
}
