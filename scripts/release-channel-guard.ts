import { writeFile } from "node:fs/promises";
import {
  parseReleaseChannelSnapshot,
  verifyBeforeCandidateEffects,
  verifyCandidateContainer,
  verifyCandidateGitHubRelease,
} from "./release-channel-snapshots.ts";
import { resolveReleaseTagPolicy } from "./release-policy.ts";

if (import.meta.main) {
  try {
    if (process.env.GITHUB_ACTIONS !== "true" || process.env.RELEASE_CHANNEL !== "next")
      throw new Error("Channel guards require the checked next workflow.");
    const policy = resolveReleaseTagPolicy(process.env.RELEASE_TAG ?? "", "next");
    const snapshot = parseReleaseChannelSnapshot(
      process.env.RELEASE_CHANNEL_BASELINE ?? "",
      process.env.GITHUB_REPOSITORY ?? "",
      policy.version,
    );
    const [command, ...extra] = process.argv.slice(2);
    if (extra.length) throw new Error("Channel guards do not accept effect overrides.");
    let digest: string | undefined;
    if (command === "before-container") await verifyBeforeCandidateEffects(snapshot);
    else if (command === "after-container") digest = await verifyCandidateContainer(snapshot);
    else if (command === "after-github") await verifyCandidateGitHubRelease(snapshot);
    else throw new Error("Unknown channel guard command.");
    await writeFile(
      `.m6-channel-${command}.json`,
      `${JSON.stringify({ snapshot, command, digest, verified: true }, null, 2)}\n`,
      { flag: "wx" },
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Release channel verification failed.");
    process.exitCode = 1;
  }
}
