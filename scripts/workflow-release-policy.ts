import { releaseGitHubRequest } from "./release-github-request.ts";
import { type ReleasePolicy, resolveReleaseTagPolicy } from "./release-policy.ts";

function resolveWorkflowRelease(input: {
  tag: string;
  channel: string;
  event: string;
  ref: string;
  eventCommit: string;
  checkoutCommit: string;
}): ReleasePolicy {
  const policy = resolveReleaseTagPolicy(input.tag, input.channel);
  if (
    policy.channel === "next" &&
    (input.event !== "workflow_dispatch" ||
      input.ref !== `refs/tags/${policy.tag}` ||
      input.eventCommit !== input.checkoutCommit)
  )
    throw new Error("Next requires manual dispatch at the exact candidate tag and source commit.");
  return policy;
}

interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  head_sha: string;
  app?: { slug?: string };
}

async function verifyWorkflowChecks(
  commit: string,
  repository: string,
  request: (url: string) => Promise<Response> = releaseGitHubRequest,
): Promise<void> {
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error("Invalid release checks source.");
  const latest = new Map<string, CheckRun>();
  let seen = 0;
  for (let page = 1; ; page++) {
    const response = await request(
      `https://api.github.com/repos/${repository}/commits/${commit}/check-runs?filter=latest&per_page=100&page=${page}`,
    );
    if (!response.ok) throw new Error("Cannot verify exact-head release checks.");
    const body = (await response.json()) as { total_count?: number; check_runs?: CheckRun[] };
    if (
      !Number.isSafeInteger(body?.total_count) ||
      (body.total_count ?? -1) < 0 ||
      !Array.isArray(body.check_runs)
    )
      throw new Error("Malformed exact-head release checks.");
    for (const check of body.check_runs) {
      if (
        !check ||
        !Number.isSafeInteger(check.id) ||
        check.id < 1 ||
        typeof check.name !== "string"
      )
        throw new Error("Malformed exact-head release checks.");
      if (check.id > (latest.get(check.name)?.id ?? 0)) latest.set(check.name, check);
    }
    seen += body.check_runs.length;
    if (seen >= (body.total_count ?? 0)) break;
    if (body.check_runs.length === 0 || page >= 100)
      throw new Error("Incomplete exact-head release checks.");
  }
  for (const name of ["test", "test-parallel", "docker-install", "sast"]) {
    const check = latest.get(name);
    if (
      !check ||
      check.head_sha !== commit ||
      check.app?.slug !== "github-actions" ||
      check.status !== "completed" ||
      check.conclusion !== "success"
    )
      throw new Error(`Required exact-head check ${name} is not successful.`);
  }
}

export { resolveWorkflowRelease, verifyWorkflowChecks };
