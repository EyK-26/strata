import { expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createReleaseWorkspace,
  releaseFixtureEnvironment,
  runReleaseFixture,
} from "../helpers/releaseWorkspace.ts";

test("actual workflow preflight enforces clean annotated exact-main source in owned Git repositories", async () => {
  const root = await createReleaseWorkspace();
  const origin = `${root}-origin.git`;
  const git = async (args: string[], cwd = root) => {
    const child = Bun.spawn(["git", ...args], {
      cwd,
      env: releaseFixtureEnvironment(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code) throw new Error(`Owned Git fixture failed: ${stderr}`);
    return stdout.trim();
  };
  try {
    await git(["init", "-b", "main"]);
    await git(["config", "user.name", "Strata owned fixture"]);
    await git(["config", "user.email", "fixture@example.invalid"]);
    await writeFile(
      join(root, ".gitignore"),
      "preflight-fixtures.ts\nworkflow-output.txt\nnode_modules/\n",
    );
    await git(["add", "--all"]);
    await git([
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "Synthetic source fixture; never a framework commit",
    ]);
    await git([
      "-c",
      "tag.gpgsign=false",
      "tag",
      "-a",
      "v1.0.0",
      "-m",
      "Owned synthetic release tag",
    ]);
    const head = await git(["rev-parse", "HEAD"]);
    await git(["init", "--bare", origin]);
    await git(["fetch", root, "main:refs/heads/main"], origin);
    await git(["remote", "add", "origin", origin]);
    const preload = join(root, "preflight-fixtures.ts");
    const checks = ["test", "test-parallel", "docker-install", "sast"].map((name, index) => ({
      id: index + 1,
      name,
      status: "completed",
      conclusion: "success",
      head_sha: head,
      app: { slug: "github-actions" },
    }));
    await writeFile(
      preload,
      `globalThis.fetch = (async (url) => {
      if(String(url).startsWith("https://api.github.com/repos/EyK-26/strata/commits/")) return Response.json(${JSON.stringify({ total_count: 4, check_runs: checks })});
      if(String(url).startsWith("https://registry.npmjs.org/")) return Response.json({name:String(url).slice("https://registry.npmjs.org/".length),versions:{}});
      throw new Error("Unexpected external request in owned preflight fixture");
    }) as typeof fetch;\n`,
    );
    const output = join(root, "workflow-output.txt");
    const run = async (context: Record<string, string> = {}) => {
      const child = Bun.spawn(
        [
          process.execPath,
          "--no-env-file",
          "--preload",
          preload,
          "scripts/verify-workflow-release.ts",
        ],
        {
          cwd: root,
          env: {
            ...releaseFixtureEnvironment(),
            GITHUB_ACTIONS: "true",
            RELEASE_TAG: "v1.0.0",
            RELEASE_CHANNEL: "stable",
            GITHUB_EVENT_NAME: "push",
            GITHUB_REF: "refs/tags/v1.0.0",
            GITHUB_SHA: head,
            GITHUB_REPOSITORY: "EyK-26/strata",
            GITHUB_TOKEN: "owned-nonproduction-read-fixture",
            GITHUB_OUTPUT: output,
            RESUME_RUN_ID: "",
            RELEASE_CHANNEL_BASELINE: "",
            ...context,
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
      return { stdout, stderr, code };
    };
    const success = await run();
    expect(success.code, success.stderr).toBe(0);
    expect(await readFile(output, "utf8")).toContain(`source_commit=${head}`);
    const untracked = join(root, "untracked-source.ts");
    await writeFile(untracked, "export const unexpected = true;\n");
    expect((await run()).code).not.toBe(0);
    await rm(untracked);
    const readme = await readFile(join(root, "README.md"), "utf8");
    await writeFile(join(root, "README.md"), `${readme}\nUncommitted source change.`);
    expect((await run()).code).not.toBe(0);
    await writeFile(join(root, "README.md"), readme);
    await git(["tag", "-d", "v1.0.0"]);
    await git(["tag", "v1.0.0"]);
    const lightweight = await run();
    expect(lightweight.code).not.toBe(0);
    expect(lightweight.stderr).toContain("annotated tag");
    await git(["tag", "-d", "v1.0.0"]);
    await git([
      "-c",
      "tag.gpgsign=false",
      "tag",
      "-a",
      "v1.0.0",
      "-m",
      "Owned synthetic release tag",
    ]);
    await writeFile(join(root, "README.md"), `${readme}\nLater owned main.`);
    await git(["-c", "commit.gpgsign=false", "commit", "-am", "Later synthetic main"]);
    await git(["fetch", root, "main:refs/heads/main"], origin);
    await git(["checkout", "--detach", "v1.0.0"]);
    const moved = await run();
    expect(moved.code).not.toBe(0);
    expect(moved.stderr).toContain("actual origin/main");

    await git(["checkout", "main"]);
    const bumped = await runReleaseFixture(root, [
      "scripts/bump.ts",
      "2.0.0-alpha.0",
      "--channel",
      "next",
    ]);
    expect(bumped.code, bumped.stderr).toBe(0);
    await git(["add", "--all"]);
    await git(["-c", "commit.gpgsign=false", "commit", "-m", "Owned synthetic next source"]);
    await git([
      "-c",
      "tag.gpgsign=false",
      "tag",
      "-a",
      "v2.0.0-alpha.0",
      "-m",
      "Owned synthetic candidate tag",
    ]);
    await git(["fetch", root, "main:refs/heads/main"], origin);
    const nextHead = await git(["rev-parse", "HEAD"]);
    const nextChecks = checks.map((check) => ({ ...check, head_sha: nextHead }));
    await writeFile(
      preload,
      `globalThis.fetch = (async (url) => {
      if(String(url).includes("/check-runs?")) return Response.json(${JSON.stringify({ total_count: 4, check_runs: nextChecks })});
      if(String(url).startsWith("https://registry.npmjs.org/")) return Response.json({name:String(url).slice("https://registry.npmjs.org/".length),versions:{}});
      if(String(url).endsWith("/releases/latest")) return Response.json({id:1,tag_name:"v1.0.0",prerelease:false});
      if(String(url)==="https://api.github.com/repos/EyK-26/strata") return Response.json({full_name:"EyK-26/strata",owner:{login:"EyK-26",type:"User"}});
      if(String(url).includes("/packages/container/strata/versions?")) return Response.json([]);
      throw new Error("Unexpected external next preflight request");
    }) as typeof fetch;\n`,
    );
    const context = {
      RELEASE_CHANNEL: "next",
      RELEASE_TAG: "v2.0.0-alpha.0",
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: "refs/tags/v2.0.0-alpha.0",
      GITHUB_SHA: nextHead,
    };
    const next = await run(context);
    expect(next.code, next.stderr).toBe(0);
    const recorded = await readFile(output, "utf8");
    const baseline = JSON.parse(
      recorded
        .split("\n")
        .filter((line) => line.startsWith("baseline="))
        .at(-1)
        ?.slice("baseline=".length) ?? "null",
    );
    expect(baseline.version).toBe("2.0.0-alpha.0");
    expect(baseline.containerLatest).toBeNull();
    baseline.githubLatest.id = 999;
    const conflict = await run({ ...context, RELEASE_CHANNEL_BASELINE: JSON.stringify(baseline) });
    expect(conflict.code).not.toBe(0);
    expect(await readFile(output, "utf8")).toBe(recorded);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(origin, { recursive: true, force: true });
  }
});
