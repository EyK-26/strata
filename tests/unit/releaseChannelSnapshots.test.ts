import { expect, test } from "bun:test";
import {
  captureReleaseChannels,
  verifyBeforeCandidateEffects,
  verifyCandidateContainer,
  verifyCandidateGitHubRelease,
} from "../../scripts/release-channel-snapshots.ts";

const repository = "EyK-26/strata";
const version = "3.0.0-alpha.0";
const stableDigest = `sha256:${"a".repeat(64)}`;
const candidateDigest = `sha256:${"b".repeat(64)}`;
function fixture() {
  const state = {
    latestId: 1,
    latestDigest: stableDigest,
    candidate: false,
    candidatePrerelease: true,
    duplicateLatest: false,
    unavailable: 0,
  };
  const request = async (url: string) => {
    if (state.unavailable)
      return new Response("owned unavailable metadata", { status: state.unavailable });
    if (url.endsWith("/releases/latest"))
      return Response.json({ id: state.latestId, tag_name: "v2.2.59", prerelease: false });
    if (url.endsWith(`/releases/tags/v${version}`))
      return Response.json({
        id: 2,
        tag_name: `v${version}`,
        prerelease: state.candidatePrerelease,
      });
    if (url === `https://api.github.com/repos/${repository}`)
      return Response.json({ full_name: repository, owner: { type: "User", login: "EyK-26" } });
    if (
      url ===
      "https://api.github.com/users/EyK-26/packages/container/strata/versions?per_page=100&page=1"
    )
      return Response.json([
        {
          name: state.latestDigest,
          metadata: { package_type: "container", container: { tags: ["latest"] } },
        },
        ...(state.candidate
          ? [
              {
                name: candidateDigest,
                metadata: { package_type: "container", container: { tags: [`v${version}`] } },
              },
            ]
          : []),
        ...(state.duplicateLatest
          ? [
              {
                name: candidateDigest,
                metadata: { package_type: "container", container: { tags: ["latest"] } },
              },
            ]
          : []),
      ]);
    throw new Error(`Unexpected owned metadata URL ${url}`);
  };
  return { state, request };
}

test("next records stable GitHub/container pointers and verifies both after publication", async () => {
  const { state, request } = fixture();
  const baseline = await captureReleaseChannels(repository, version, request);
  expect(baseline.githubLatest).toEqual({ id: 1, tag: "v2.2.59" });
  expect(baseline.containerLatest).toBe(stableDigest);
  await expect(verifyBeforeCandidateEffects(baseline, request)).resolves.toBeUndefined();
  state.candidate = true;
  await expect(verifyCandidateContainer(baseline, request)).resolves.toBe(candidateDigest);
  await expect(verifyCandidateGitHubRelease(baseline, request)).resolves.toBeUndefined();
});

test("an existing candidate image requires identity review instead of overwrite or assumed resume", async () => {
  const { state, request } = fixture();
  const baseline = await captureReleaseChannels(repository, version, request);
  state.candidate = true;
  await expect(captureReleaseChannels(repository, version, request)).rejects.toThrow(
    "already exists",
  );
  await expect(verifyBeforeCandidateEffects(baseline, request)).rejects.toThrow("already exists");
});

test("foreign stable pointer changes, missing output and wrong GitHub release classification block acceptance", async () => {
  const { state, request } = fixture();
  const baseline = await captureReleaseChannels(repository, version, request);
  state.latestId = 2;
  await expect(verifyBeforeCandidateEffects(baseline, request)).rejects.toThrow("stable");
  state.latestId = 1;
  state.latestDigest = candidateDigest;
  await expect(verifyBeforeCandidateEffects(baseline, request)).rejects.toThrow("stable");
  state.latestDigest = stableDigest;
  await expect(verifyCandidateContainer(baseline, request)).rejects.toThrow("missing");
  state.candidatePrerelease = false;
  await expect(verifyCandidateGitHubRelease(baseline, request)).rejects.toThrow("prerelease");
});

test("unknown and ambiguous channel metadata fail closed", async () => {
  const { state, request } = fixture();
  state.duplicateLatest = true;
  await expect(captureReleaseChannels(repository, version, request)).rejects.toThrow("Ambiguous");
  state.duplicateLatest = false;
  for (const status of [401, 403, 404, 429, 503]) {
    state.unavailable = status;
    await expect(captureReleaseChannels(repository, version, request)).rejects.toThrow("channel");
  }
});
