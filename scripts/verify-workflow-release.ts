import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchPublishedPackageMetadata } from "./published-package-versions.ts";
import {
  captureReleaseChannels,
  parseReleaseChannelSnapshot,
  verifyBeforeCandidateEffects,
} from "./release-channel-snapshots.ts";
import { RELEASE_PACKAGES } from "./release-packages.ts";
import { resolveWorkflowRelease, verifyWorkflowChecks } from "./workflow-release-policy.ts";

const ROOT = join(import.meta.dir, "..");
async function git(args: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error(
      `Release source verification failed: git ${args.join(" ")} (${stderr.trim()}).`,
    );
  return stdout.trim();
}

async function verifyWorkflowRelease(): Promise<void> {
  if (process.env.GITHUB_ACTIONS !== "true")
    throw new Error("This is a workflow-only release preflight.");
  const head = await git(["rev-parse", "HEAD"]);
  const policy = resolveWorkflowRelease({
    tag: process.env.RELEASE_TAG ?? "",
    channel: process.env.RELEASE_CHANNEL ?? "stable",
    event: process.env.GITHUB_EVENT_NAME ?? "",
    ref: process.env.GITHUB_REF ?? "",
    eventCommit: process.env.GITHUB_SHA ?? "",
    checkoutCommit: head,
  });
  const resume = process.env.RESUME_RUN_ID ?? "";
  if (resume && (policy.channel !== "next" || !/^[1-9]\d*$/.test(resume)))
    throw new Error("A candidate source run is supported only for explicit next recovery.");
  await git(["fetch", "--no-tags", "origin", "refs/heads/main:refs/remotes/origin/main"]);
  if (
    head !== (await git(["rev-parse", "origin/main"])) ||
    head !== (await git(["rev-parse", `${policy.tag}^{commit}`])) ||
    (await git(["cat-file", "-t", `refs/tags/${policy.tag}`])) !== "tag"
  )
    throw new Error(
      "Release requires an annotated tag at actual origin/main's exact approved head.",
    );
  await git(["diff", "--exit-code", "HEAD", "--"]);
  if (await git(["status", "--porcelain", "--untracked-files=normal"])) {
    throw new Error("Release checkout has uncommitted source changes.");
  }
  await verifyWorkflowChecks(head, process.env.GITHUB_REPOSITORY ?? "");
  const child = Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      "scripts/verify-release-ready.ts",
      policy.tag,
      "--channel",
      policy.channel,
    ],
    { cwd: ROOT, stdout: "inherit", stderr: "inherit" },
  );
  if ((await child.exited) !== 0) throw new Error("Release metadata/target preflight failed.");
  // Recovery may include immutable existing versions. Validate authoritative reads
  // here; stable skip or next integrity verification decides their admissibility.
  for (const [name] of RELEASE_PACKAGES) await fetchPublishedPackageMetadata(name);
  for (const [, directory] of RELEASE_PACKAGES) {
    const manifest = JSON.parse(await readFile(join(ROOT, directory, "package.json"), "utf8")) as {
      version: string;
    };
    if (manifest.version !== policy.version)
      throw new Error("Release policy and package manifest disagree.");
  }
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("Missing workflow output destination.");
  const outputs = [
    `channel=${policy.channel}`,
    `version=${policy.version}`,
    `candidate_artifact=m6-candidate-${policy.version}`,
    `source_commit=${head}`,
    `policy=${JSON.stringify(policy)}`,
  ];
  if (policy.channel === "next") {
    const previous = process.env.RELEASE_CHANNEL_BASELINE;
    const snapshot = previous
      ? parseReleaseChannelSnapshot(previous, process.env.GITHUB_REPOSITORY ?? "", policy.version)
      : await captureReleaseChannels(process.env.GITHUB_REPOSITORY ?? "", policy.version);
    if (previous) await verifyBeforeCandidateEffects(snapshot);
    outputs.push(`baseline=${JSON.stringify(snapshot)}`);
  }
  await appendFile(output, `${outputs.join("\n")}\n`);
}

if (import.meta.main) {
  try {
    await verifyWorkflowRelease();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Release preflight failed.");
    process.exitCode = 1;
  }
}

export { verifyWorkflowRelease };
