import { parseStableVersion } from "./stable-version.ts";

type ReleaseChannel = "stable" | "next";
interface ReleasePolicy {
  version: string;
  tag: string;
  channel: ReleaseChannel;
  npmTag: "latest" | "next";
  github: { prerelease?: true; makeLatest?: false };
  containerAliases: readonly string[];
  dependencyPin: string;
}

function isCandidateVersion(version: string): boolean {
  const match = /^(\d+\.\d+\.\d+)-(alpha|beta|rc)\.(0|[1-9]\d*)$/.exec(version);
  return (
    !!match &&
    match[0] === version &&
    parseStableVersion(match[1] ?? "") !== null &&
    Number.isSafeInteger(Number(match[3]))
  );
}

function resolveReleasePolicy(version: string, channel: string = "stable"): ReleasePolicy {
  if (channel === "stable" && parseStableVersion(version) !== null) {
    return {
      version,
      tag: `v${version}`,
      channel,
      npmTag: "latest",
      github: {},
      containerAliases: ["latest"],
      dependencyPin: `^${version}`,
    };
  }
  if (channel === "next" && isCandidateVersion(version)) {
    return {
      version,
      tag: `v${version}`,
      channel,
      npmTag: "next",
      github: { prerelease: true, makeLatest: false },
      containerAliases: [],
      dependencyPin: version,
    };
  }
  throw new Error(`Unsupported release policy: ${channel} / ${JSON.stringify(version)}.`);
}

function resolveReleaseTagPolicy(tag: string, channel: string = "stable"): ReleasePolicy {
  if (!tag.startsWith("v"))
    throw new Error(`Unsupported release policy tag ${JSON.stringify(tag)}.`);
  return resolveReleasePolicy(tag.slice(1), channel);
}

function compareReleaseVersions(left: string, right: string): number {
  for (const value of [left, right]) {
    resolveReleasePolicy(value, isCandidateVersion(value) ? "next" : "stable");
  }
  return Bun.semver.order(left, right);
}

export type { ReleaseChannel, ReleasePolicy };
export { compareReleaseVersions, resolveReleasePolicy, resolveReleaseTagPolicy };
