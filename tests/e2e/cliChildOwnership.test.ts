import { test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidatePackage } from "../../scripts/candidate-packages";

async function ready(path: string) {
  const deadline = Date.now() + 5000;
  while (!(await Bun.file(path).exists()) && Date.now() < deadline) await Bun.sleep(10);
  assert.equal(
    await Bun.file(path).exists(),
    true,
    `Packed child did not report readiness: ${path}`,
  );
  return JSON.parse(await readFile(path, "utf8")) as {
    pid: number;
    cwd: string;
    argv: string[];
    marker: string;
    preload: string;
    core: string;
  };
}

async function ownedChildAlive(pid: number, root: string) {
  try {
    return (await realpath(`/proc/${pid}/cwd`)) === root;
  } catch (error) {
    if (error instanceof Error && ["ENOENT", "ESRCH"].includes(String(Reflect.get(error, "code"))))
      return false;
    throw error;
  }
}

test("installed CLI start, run and dev supervise real children through candidate packages", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strata-packed-child-"));
  const archives: Record<string, string> = {};
  const reports: unknown[] = [];
  try {
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    for (const part of ["core", "cli"] as const) {
      const archive = await candidatePackage(part, directory);
      archives[part] = createHash("sha256")
        .update(await readFile(archive))
        .digest("hex");
      const destination = join(directory, `node_modules/@getstrata/${part}`);
      await mkdir(destination, { recursive: true });
      const unpack = Bun.spawn(
        ["tar", "-xzf", archive, "--strip-components=1", "-C", destination],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [status, errors] = await Promise.all([
        unpack.exited,
        new Response(unpack.stderr).text(),
      ]);
      assert.equal(status, 0, errors);
      assert.equal(
        await realpath(destination),
        destination,
        "Candidate package must not be a workspace symlink",
      );
    }
    const cli = join(directory, "node_modules/@getstrata/cli/cli.ts");
    for (const command of ["start", "run", "dev"] as const) {
      const root = join(directory, command);
      await mkdir(root);
      await writeFile(
        join(root, "strata.config.ts"),
        'export default { preload: "./preload.ts", server: "./server.ts" };',
      );
      await writeFile(
        join(root, "preload.ts"),
        "process.env.STRATA_CHILD_PRELOAD_MARKER = process.env.STRATA_CHILD_OWNERSHIP_MARKER;",
      );
      await copyFile(
        join(import.meta.dir, "../fixtures/cliChildOwnershipConsumer.ts"),
        join(root, "server.ts"),
      );
      const marker = `owned-${command}`;
      const argv =
        command === "run"
          ? [command, "server.ts", "literal argument", "--literal-flag"]
          : [command];
      const parent = Bun.spawn([process.execPath, "--no-env-file", cli, ...argv], {
        cwd: root,
        env: { ...process.env, STRATA_CHILD_OWNERSHIP_MARKER: marker },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: 8000,
        killSignal: "SIGKILL",
      });
      let childPid: number | undefined;
      const output = new Response(parent.stdout).text();
      const errors = new Response(parent.stderr).text();
      try {
        const report = await ready(join(root, "ready.json")).catch(async (error) => {
          if (parent.exitCode === null && parent.signalCode === null) parent.kill("SIGTERM");
          await parent.exited;
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nstdout:\n${await output}\nstderr:\n${await errors}`,
            { cause: error },
          );
        });
        childPid = report.pid;
        assert.notEqual(childPid, parent.pid);
        assert.equal(report.cwd, root);
        assert.equal(report.marker, marker);
        assert.equal(report.preload, marker);
        assert.deepEqual(
          report.argv,
          command === "run" ? ["literal argument", "--literal-flag"] : [],
        );
        assert.ok(report.core.startsWith(`file://${directory}/node_modules/@getstrata/core/`));
        parent.kill(command === "run" ? "SIGINT" : "SIGTERM");
        const exitCode = await parent.exited;
        assert.equal(exitCode, 7, `${command} changed the actual child's acknowledged exit code`);
        const drained = JSON.parse(await readFile(join(root, "drained.json"), "utf8"));
        assert.equal(drained.pid, childPid);
        assert.equal(drained.signal, command === "run" ? "SIGINT" : "SIGTERM");
        assert.equal(
          await ownedChildAlive(childPid, root),
          false,
          "Acknowledged child is still alive",
        );
        assert.ok((await output).includes(`child-stdout:${marker}`));
        assert.ok((await errors).includes(`child-stderr:${marker}`));
        reports.push({ command, parentPid: parent.pid, childPid, exitCode, core: report.core });
      } finally {
        if (parent.exitCode === null && parent.signalCode === null) parent.kill("SIGKILL");
        await parent.exited;
        if (childPid !== undefined && (await ownedChildAlive(childPid, root))) {
          // Confirm the unique owned cwd before targeting a recorded PID; avoid stale-PID cleanup.
          process.kill(childPid, "SIGKILL");
        }
        await Promise.all([output, errors]);
      }
    }
    console.log(JSON.stringify({ archives, reports, ownershipScope: "direct parent/child only" }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 35000);
