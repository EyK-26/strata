// Admission requires a successful main-branch CI run for the exact tagged commit.
// GitHub API errors, partial job state and unrelated workflows must fail closed.
export interface CIRun {
  head_sha: string;
  head_branch: string;
  event: string;
  status: string;
  conclusion: string | null;
}
export function hasAcceptedCI(runs: readonly CIRun[], commit: string): boolean {
  return runs.some(
    (run) =>
      run.head_sha === commit &&
      run.head_branch === "main" &&
      run.event === "push" &&
      run.status === "completed" &&
      run.conclusion === "success",
  );
}
if (import.meta.main) {
  const commit = Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim();
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository || !/^[0-9a-f]{40}$/.test(commit))
    throw new Error("Missing release source identity");
  const result = Bun.spawnSync([
    "gh",
    "api",
    `repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${commit}&event=push&status=success&per_page=100`,
  ]);
  if (result.exitCode !== 0) throw new Error("Cannot establish exact-head CI success");
  const response = JSON.parse(result.stdout.toString());
  if (!Array.isArray(response.workflow_runs) || !hasAcceptedCI(response.workflow_runs, commit))
    throw new Error(`No successful main CI run for ${commit}`);
  console.log(`Exact-head CI accepted: ${commit}`);
}
