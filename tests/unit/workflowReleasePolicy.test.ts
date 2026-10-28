import { expect, test } from "bun:test";
import {
  resolveWorkflowRelease,
  verifyWorkflowChecks,
} from "../../scripts/workflow-release-policy.ts";

const commit = "1".repeat(40);
const repository = "EyK-26/strata";
const next = {
  tag: "v3.0.0-alpha.0",
  channel: "next",
  event: "workflow_dispatch",
  ref: "refs/tags/v3.0.0-alpha.0",
  eventCommit: commit,
  checkoutCommit: commit,
};

test("next requires manual dispatch at the exact tag ref and source commit", () => {
  expect(resolveWorkflowRelease(next).channel).toBe("next");
  for (const change of [
    { event: "push" },
    { ref: "refs/heads/main" },
    { eventCommit: "2".repeat(40) },
    { channel: "stable" },
  ]) {
    expect(() => resolveWorkflowRelease({ ...next, ...change })).toThrow();
  }
  expect(
    resolveWorkflowRelease({
      ...next,
      tag: "v2.2.59",
      channel: "stable",
      event: "push",
      ref: "refs/tags/v2.2.59",
    }).channel,
  ).toBe("stable");
});

const checks = ["test", "test-parallel", "docker-install", "sast"].map((name, index) => ({
  id: index + 1,
  name,
  status: "completed",
  conclusion: "success",
  head_sha: commit,
  app: { slug: "github-actions" },
}));
test("all four exact-head GitHub Actions checks must be successful", async () => {
  const request = async (url: string) => {
    expect(url).toBe(
      `https://api.github.com/repos/${repository}/commits/${commit}/check-runs?filter=latest&per_page=100&page=1`,
    );
    return Response.json({ total_count: checks.length, check_runs: checks });
  };
  await expect(verifyWorkflowChecks(commit, repository, request)).resolves.toBeUndefined();
  for (const change of [
    { status: "in_progress", conclusion: null },
    { conclusion: "failure" },
    { head_sha: "2".repeat(40) },
    { app: { slug: "foreign-app" } },
  ]) {
    await expect(
      verifyWorkflowChecks(commit, repository, async () =>
        Response.json({
          total_count: 4,
          check_runs: [{ ...checks[0], ...change }, ...checks.slice(1)],
        }),
      ),
    ).rejects.toThrow("exact-head");
  }
  await expect(
    verifyWorkflowChecks(commit, repository, async () =>
      Response.json({ total_count: 3, check_runs: checks.slice(1) }),
    ),
  ).rejects.toThrow("exact-head");
  await expect(
    verifyWorkflowChecks(
      commit,
      repository,
      async () => new Response("unavailable", { status: 503 }),
    ),
  ).rejects.toThrow("checks");
});

test("an older green result cannot hide a newer pending check, including on a later API page", async () => {
  let page = 0;
  await expect(
    verifyWorkflowChecks(commit, repository, async () => {
      page++;
      return Response.json({
        total_count: 5,
        check_runs:
          page === 1
            ? checks
            : [{ ...checks[0], id: 100, status: "in_progress", conclusion: null }],
      });
    }),
  ).rejects.toThrow("exact-head");
  expect(page).toBe(2);
});
