import { releaseGitHubRequest } from "./release-github-request.ts";
import { resolveReleasePolicy, resolveReleaseTagPolicy } from "./release-policy.ts";

interface ReleaseChannelSnapshot {
  schema: 1;
  repository: string;
  version: string;
  githubLatest: { id: number; tag: string };
  containerLatest: string | null;
}
type ReadMetadata = (url: string) => Promise<Response>;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

async function json(url: string, request: ReadMetadata): Promise<unknown> {
  const response = await request(url);
  if (!response.ok) throw new Error("Cannot verify release channel metadata.");
  return response.json();
}

async function githubLatest(repository: string, request: ReadMetadata) {
  const release = (await json(
    `https://api.github.com/repos/${repository}/releases/latest`,
    request,
  )) as { id?: number; tag_name?: string; prerelease?: boolean } | null;
  if (
    !release ||
    !Number.isSafeInteger(release.id) ||
    (release.id ?? 0) < 1 ||
    typeof release.tag_name !== "string" ||
    release.prerelease !== false
  )
    throw new Error("Cannot verify stable GitHub channel metadata.");
  resolveReleaseTagPolicy(release.tag_name, "stable");
  return { id: release.id as number, tag: release.tag_name };
}

async function containerChannels(repository: string, version: string, request: ReadMetadata) {
  const repo = (await json(`https://api.github.com/repos/${repository}`, request)) as {
    full_name?: string;
    owner?: { type?: string; login?: string };
  } | null;
  const [owner, name] = repository.split("/");
  if (
    !repo ||
    repo.full_name !== repository ||
    repo.owner?.login !== owner ||
    !["User", "Organization"].includes(repo.owner?.type ?? "")
  )
    throw new Error("Cannot verify container channel ownership.");
  const namespace = repo.owner?.type === "User" ? "users" : "orgs";
  const tags = new Map<string, string>();
  const candidate = `v${version}`;
  for (let page = 1; ; page++) {
    const response = await request(
      `https://api.github.com/${namespace}/${owner}/packages/container/${name?.toLowerCase()}/versions?per_page=100&page=${page}`,
    );
    if (!response.ok) throw new Error("Cannot verify container channel metadata.");
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error("Malformed container channel metadata.");
    for (const entry of body as Array<{
      name?: unknown;
      metadata?: { package_type?: string; container?: { tags?: unknown } };
    }>) {
      const names = entry?.metadata?.container?.tags;
      if (
        entry?.metadata?.package_type !== "container" ||
        !Array.isArray(names) ||
        names.some((value) => typeof value !== "string")
      )
        throw new Error("Malformed container channel metadata.");
      for (const tag of names as string[]) {
        if (tag !== "latest" && tag !== candidate) continue;
        if (typeof entry.name !== "string" || !DIGEST.test(entry.name))
          throw new Error("Malformed container channel digest.");
        if (tags.has(tag)) throw new Error(`Ambiguous container channel ${tag}.`);
        tags.set(tag, entry.name);
      }
    }
    if (body.length < 100 && !response.headers.get("link")?.includes('rel="next"')) break;
    if (page >= 100 || body.length === 0) throw new Error("Incomplete container channel metadata.");
  }
  return { latest: tags.get("latest") ?? null, candidate: tags.get(candidate) ?? null };
}

function parseReleaseChannelSnapshot(
  value: string,
  repository: string,
  version: string,
): ReleaseChannelSnapshot {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error("Invalid release channel repository.");
  resolveReleasePolicy(version, "next");
  const snapshot = JSON.parse(value) as ReleaseChannelSnapshot;
  if (
    snapshot?.schema !== 1 ||
    snapshot.repository !== repository ||
    snapshot.version !== version ||
    !Number.isSafeInteger(snapshot.githubLatest?.id) ||
    snapshot.githubLatest.id < 1 ||
    typeof snapshot.githubLatest.tag !== "string" ||
    (snapshot.containerLatest !== null &&
      (typeof snapshot.containerLatest !== "string" || !DIGEST.test(snapshot.containerLatest)))
  )
    throw new Error("Invalid release channel baseline.");
  resolveReleaseTagPolicy(snapshot.githubLatest.tag, "stable");
  return snapshot;
}

async function captureReleaseChannels(
  repository: string,
  version: string,
  request: ReadMetadata = releaseGitHubRequest,
): Promise<ReleaseChannelSnapshot> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error("Invalid release channel repository.");
  resolveReleasePolicy(version, "next");
  const latest = await githubLatest(repository, request);
  const container = await containerChannels(repository, version, request);
  if (container.candidate !== null)
    throw new Error(
      "Candidate image tag already exists; retained identity requires review, never overwrite.",
    );
  return {
    schema: 1,
    repository,
    version,
    githubLatest: latest,
    containerLatest: container.latest,
  };
}

async function verifyBeforeCandidateEffects(
  snapshot: ReleaseChannelSnapshot,
  request: ReadMetadata = releaseGitHubRequest,
): Promise<void> {
  const latest = await githubLatest(snapshot.repository, request);
  if (latest.id !== snapshot.githubLatest.id || latest.tag !== snapshot.githubLatest.tag)
    throw new Error("GitHub stable channel pointer changed; stop for ownership review.");
  const container = await containerChannels(snapshot.repository, snapshot.version, request);
  if (container.latest !== snapshot.containerLatest)
    throw new Error("Container stable channel pointer changed; stop for ownership review.");
  if (container.candidate !== null)
    throw new Error(
      "Candidate image tag already exists; retained identity requires review, never overwrite.",
    );
}

async function verifyCandidateContainer(
  snapshot: ReleaseChannelSnapshot,
  request: ReadMetadata = releaseGitHubRequest,
): Promise<string> {
  const container = await containerChannels(snapshot.repository, snapshot.version, request);
  if (container.latest !== snapshot.containerLatest)
    throw new Error("Container stable channel pointer changed; acceptance is incomplete.");
  if (container.candidate === null) throw new Error("Candidate container output is missing.");
  return container.candidate;
}

async function verifyCandidateGitHubRelease(
  snapshot: ReleaseChannelSnapshot,
  request: ReadMetadata = releaseGitHubRequest,
): Promise<void> {
  const latest = await githubLatest(snapshot.repository, request);
  if (latest.id !== snapshot.githubLatest.id || latest.tag !== snapshot.githubLatest.tag)
    throw new Error("GitHub stable channel pointer changed; acceptance is incomplete.");
  const release = (await json(
    `https://api.github.com/repos/${snapshot.repository}/releases/tags/v${snapshot.version}`,
    request,
  )) as { tag_name?: string; prerelease?: boolean } | null;
  if (!release || release.tag_name !== `v${snapshot.version}` || release.prerelease !== true)
    throw new Error("Candidate GitHub output is not the expected prerelease.");
}

export type { ReleaseChannelSnapshot };
export {
  captureReleaseChannels,
  parseReleaseChannelSnapshot,
  verifyBeforeCandidateEffects,
  verifyCandidateContainer,
  verifyCandidateGitHubRelease,
};
