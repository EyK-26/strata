import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnBun } from "../../../packages/strata-cli/src/spawnBun.ts";

const cli = join(import.meta.dir, "../../../packages/strata-cli/cli.ts");
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`CLI child supervision relays ${signal}, waits for draining and preserves exit status`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "strata-signal-"));
    let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
    try {
      await Bun.write(
        join(directory, "server.ts"),
        `
const keepAlive = setInterval(() => {}, 1000);
let draining = false;
process.on("${signal}", async () => {
  if (draining) return; draining = true;
  await Bun.sleep(150);
  await Bun.write("drained", "${signal}");
  clearInterval(keepAlive); process.exit(7);
});
await Bun.write("ready", "ready");`,
      );
      await Bun.write(
        join(directory, "strata.config.ts"),
        'export default { server: "server.ts" };',
      );
      child = Bun.spawn([process.execPath, "--no-env-file", cli, "start"], {
        cwd: directory,
        stdout: "pipe",
        stderr: "pipe",
        timeout: 5000,
        killSignal: "SIGKILL",
      });
      const deadline = Date.now() + 3000;
      while (!(await Bun.file(join(directory, "ready")).exists()) && Date.now() < deadline)
        await Bun.sleep(10);
      expect(await Bun.file(join(directory, "ready")).exists()).toBe(true);
      child.kill(signal);
      const [exit, errors] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect(exit).toBe(7);
      expect(errors).toBe("");
      expect(await readFile(join(directory, "drained"), "utf8")).toBe(signal);
    } finally {
      if (child?.exitCode === null) child.kill("SIGKILL");
      await child?.exited;
      await rm(directory, { recursive: true, force: true });
    }
  }, 7000);
}

test("child completion removes only its supervisor signal listeners", async () => {
  const sigint = () => {};
  const sigterm = () => {};
  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  const beforeSigint = process.listeners("SIGINT");
  const beforeSigterm = process.listeners("SIGTERM");
  try {
    expect(await spawnBun({ root: process.cwd() }, ["--eval", "process.exit(3)"])).toBe(3);
    expect(process.listeners("SIGINT")).toEqual(beforeSigint);
    expect(process.listeners("SIGTERM")).toEqual(beforeSigterm);
  } finally {
    process.off("SIGINT", sigint);
    process.off("SIGTERM", sigterm);
  }
});
