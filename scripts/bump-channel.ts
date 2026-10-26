import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildBumpPlan,
  finishBump,
  PACKAGE_JSON_FILES,
  readCurrentVersion,
  runStableBump,
} from "./bump.ts";
import { channelBumpTransforms } from "./channel-bump-transforms.ts";
import { takeReleaseChannel } from "./release-channel-options.ts";
import { compareReleaseVersions, resolveReleasePolicy } from "./release-policy.ts";

async function runChannelBump(root: string, originalArgs: string[]): Promise<void> {
  const { channel, args } = takeReleaseChannel(originalArgs);
  const promote = args.includes("--promote");
  if (channel === "stable" && !promote) return runStableBump(args);
  const positional: string[] = [];
  let notes = "";
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--notes") {
      notes = args[++index] ?? "";
    } else if (arg !== "--check" && arg !== "--promote") positional.push(arg);
  }
  if (positional.length !== 1)
    throw new Error("Supply one release version and an explicit channel.");
  const version = (positional[0] ?? "").trim();
  const policy = resolveReleasePolicy(version, channel);
  const current = await readCurrentVersion(root);
  const sourcePolicy = resolveReleasePolicy(current, current.includes("-") ? "next" : "stable");
  if (
    promote &&
    (channel !== "stable" || sourcePolicy.channel !== "next" || current.split("-")[0] !== version)
  ) {
    throw new Error("Promotion requires the stable counterpart of the current next candidate.");
  }
  if (compareReleaseVersions(version, current) < 0)
    throw new Error(`Refusing to bump: ${version} is older than ${current}.`);
  const manifests = await Promise.all(
    PACKAGE_JSON_FILES.map(
      async (file) =>
        JSON.parse(await readFile(join(root, file), "utf8")) as { name: string; version: string },
    ),
  );
  if (manifests.some((metadata) => metadata.version !== current))
    throw new Error("Source packages must be in lockstep before a channel bump.");
  const pending = await buildBumpPlan(root, version, notes, channelBumpTransforms(policy));
  const names = new Set(manifests.map((metadata) => metadata.name));
  for (const file of PACKAGE_JSON_FILES) {
    const metadata = JSON.parse(
      pending.get(file) ?? (await readFile(join(root, file), "utf8")),
    ) as { version: string; peerDependencies?: Record<string, string> };
    if (metadata.version !== version) throw new Error(`Version edit did not apply to ${file}.`);
    for (const [name, range] of Object.entries(metadata.peerDependencies ?? {})) {
      if (names.has(name) && range !== policy.dependencyPin)
        throw new Error(`Unsupported internal peer pin ${name}@${range} in ${file}.`);
    }
  }
  await finishBump(root, current, version, pending, args.includes("--check"), notes);
  if (channel === "next")
    console.log(
      `Candidate preflight: bun run release:check v${version} --channel next --check-npm`,
    );
}

export { runChannelBump };
