import { type CandidateSource, validateCandidateSource } from "./candidate-artifacts.ts";
import { releaseGitHubRequest } from "./release-github-request.ts";

async function verifyCandidateSourceRun(
  source: CandidateSource,
  request?: (url: string) => Promise<Response>,
): Promise<void> {
  validateCandidateSource(source);
  const get = request ?? releaseGitHubRequest;
  const response = await get(
    `https://api.github.com/repos/${source.repository}/actions/runs/${source.runId}`,
  );
  if (!response.ok) throw new Error("Cannot verify candidate source run.");
  const run = (await response.json()) as {
    id?: number;
    head_sha?: string;
    path?: string;
    event?: string;
    repository?: { full_name?: string };
  };
  if (
    !run ||
    String(run.id) !== source.runId ||
    run.head_sha !== source.commit ||
    run.path !== ".github/workflows/release.yml" ||
    run.event !== "workflow_dispatch" ||
    run.repository?.full_name !== source.repository
  )
    throw new Error("Candidate source run does not match this repository, workflow and commit.");
}

export { verifyCandidateSourceRun };
