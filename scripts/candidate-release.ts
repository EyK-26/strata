import { join } from "node:path";
import { type CandidateSource, packCandidateArtifacts } from "./candidate-artifacts.ts";
import { publishCandidate } from "./candidate-publication.ts";
import { verifyCandidateSourceRun } from "./candidate-source-run.ts";
import { resolveWorkflowRelease } from "./workflow-release-policy.ts";

async function runCandidateRelease(): Promise<void> {
  if (process.env.GITHUB_ACTIONS !== "true")
    throw new Error("Candidate effects require the checked manual GitHub workflow.");
  const root = join(import.meta.dir, "..");
  const git = Bun.spawn(["git", "rev-parse", "HEAD"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [head, , code] = await Promise.all([
    new Response(git.stdout).text(),
    new Response(git.stderr).text(),
    git.exited,
  ]);
  if (code !== 0) throw new Error("Cannot verify the candidate checkout.");
  const policy = resolveWorkflowRelease({
    tag: process.env.RELEASE_TAG ?? "",
    channel: process.env.RELEASE_CHANNEL ?? "",
    event: process.env.GITHUB_EVENT_NAME ?? "",
    ref: process.env.GITHUB_REF ?? "",
    eventCommit: process.env.GITHUB_SHA ?? "",
    checkoutCommit: head.trim(),
  });
  if (policy.channel !== "next") throw new Error("Candidate effects require channel next.");
  const source: CandidateSource = {
    commit: head.trim(),
    repository: process.env.GITHUB_REPOSITORY ?? "",
    runId: process.env.CANDIDATE_SOURCE_RUN_ID ?? process.env.GITHUB_RUN_ID ?? "",
  };
  const [command, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error("Candidate commands do not accept effect overrides.");
  const directory = join(root, ".candidate");
  if (command === "verify-source") await verifyCandidateSourceRun(source);
  else if (command === "pack") {
    if (source.runId !== process.env.GITHUB_RUN_ID)
      throw new Error("An existing source run must be loaded, never repacked.");
    const ledger = await packCandidateArtifacts(root, directory, source);
    if (ledger.version !== policy.version)
      throw new Error("Candidate ledger does not match the dispatched tag.");
  } else if (command === "publish") {
    await publishCandidate(
      root,
      directory,
      source,
      `${process.env.GITHUB_RUN_ID ?? ""}-${process.env.GITHUB_RUN_ATTEMPT ?? ""}`,
      fetch,
      "npm",
    );
  } else throw new Error("Candidate command must be verify-source, pack or publish.");
}

if (import.meta.main) {
  try {
    await runCandidateRelease();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Candidate release failed.");
    process.exitCode = 1;
  }
}

export { runCandidateRelease };
