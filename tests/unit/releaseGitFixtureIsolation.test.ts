import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("release Git fixtures cannot mutate the caller repository through hook environment", async () => {
  const outer = await mkdtemp(join(tmpdir(), "strata-m6-git-caller-"));
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
  const env = { ...clean, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = async (args: string[]) => {
    const child = Bun.spawn(["git", ...args], {
      cwd: outer,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code) throw new Error(`Disposable caller setup failed: ${stderr}`);
    return stdout.trim();
  };
  const digest = async (file: string) =>
    createHash("sha256")
      .update(await readFile(join(outer, file)))
      .digest("hex");
  const snapshot = async () => ({
    head: await git(["rev-parse", "HEAD"]),
    refs: await git(["for-each-ref", "--format=%(refname) %(objectname)"]),
    config: await digest(".git/config"),
    index: await digest(".git/index"),
    source: await digest("caller-owned.txt"),
  });
  try {
    await git(["init", "-b", "main"]);
    await git(["config", "user.name", "Disposable caller"]);
    await git(["config", "user.email", "caller@example.invalid"]);
    await writeFile(join(outer, "caller-owned.txt"), "Must remain unchanged.\n");
    await git(["add", "caller-owned.txt"]);
    await git(["-c", "commit.gpgsign=false", "commit", "-m", "Owned caller sentinel"]);
    await git(["-c", "tag.gpgsign=false", "tag", "-a", "v1.0.0", "-m", "Owned existing tag"]);
    const before = await snapshot();
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "test",
        "--isolate",
        join(import.meta.dir, "workflowReleaseSource.test.ts"),
      ],
      {
        cwd: join(import.meta.dir, "../.."),
        env: {
          ...env,
          SKIP_FIXTURE_TEST_BOOTSTRAP: "1",
          GIT_DIR: join(outer, ".git"),
          GIT_COMMON_DIR: join(outer, ".git"),
          GIT_INDEX_FILE: join(outer, ".git/index"),
          GIT_PREFIX: "hook-prefix/",
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "core.bare",
          GIT_CONFIG_VALUE_0: "true",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ code, caller: await snapshot() }, `${stdout}\n${stderr}`).toEqual({
      code: 0,
      caller: before,
    });
  } finally {
    await rm(outer, { recursive: true, force: true });
  }
}, 30_000);
