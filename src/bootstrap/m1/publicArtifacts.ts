/** LOCAL REVIEW PROTOTYPE: API names are provisional and unpublished. */

import {
  buildIdentity,
  logicalName,
  type PublicArtifactEntry,
  validateArtifactEntry,
} from "./artifactManifest";

export { collectPublicArtifactManifest, verifyPublicArtifactFiles } from "./artifactFiles";
export type { PublicArtifactEntry, PublicArtifactManifest } from "./artifactManifest";

import {
  assertApprovedDestination,
  dataArray,
  dataRecord,
  exactKeys,
  M1ConfigurationError,
  relativePath,
} from "./validation";

export type PublicArtifactPolicy = Readonly<{ origin: string; releasePrefix: string }>;
export type ResolvedPublicArtifact = Readonly<
  Omit<PublicArtifactEntry, "relativePath"> & { url: string }
>;
export type PublicArtifactResolver = Readonly<{
  buildId: string;
  resolve(name: string): ResolvedPublicArtifact;
}>;
export type DocumentArtifactPlan = Readonly<{
  buildId: string;
  entryScripts: readonly string[];
  windowModules: readonly string[];
  stylesheets: readonly string[];
}>;
export function createPublicArtifactResolver(
  manifest: unknown,
  policy: PublicArtifactPolicy,
  options: { allowHttpLoopback?: boolean } = {},
): PublicArtifactResolver {
  const input = dataRecord(manifest, "manifest");
  exactKeys(input, ["format", "buildId", "artifacts"], "manifest");
  if (input.format !== 1) throw new M1ConfigurationError("unsupported-format", "format");
  const buildId = buildIdentity(input.buildId);
  const approved = dataRecord(policy, "policy");
  exactKeys(approved, ["origin", "releasePrefix"], "policy");
  if (typeof approved.origin !== "string" || !URL.canParse(approved.origin))
    throw new M1ConfigurationError("invalid-origin", "policy.origin");
  const origin = new URL(approved.origin);
  const loopback =
    options.allowHttpLoopback &&
    origin.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (
    origin.origin !== approved.origin ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    !(origin.protocol === "https:" || loopback)
  )
    throw new M1ConfigurationError("invalid-origin", "policy.origin");
  if (
    typeof approved.releasePrefix !== "string" ||
    !approved.releasePrefix.startsWith("/") ||
    !approved.releasePrefix.endsWith("/")
  )
    throw new M1ConfigurationError("invalid-prefix", "policy.releasePrefix");
  const prefix = relativePath(approved.releasePrefix.slice(1, -1), "policy.releasePrefix");
  if (prefix.split("/").at(-1) !== buildId)
    throw new M1ConfigurationError("build-prefix-mismatch", "policy.releasePrefix");
  const entries = dataRecord(input.artifacts, "artifacts");
  const snapshot = new Map<string, ResolvedPublicArtifact>();
  const destinations = new Set<string>();
  for (const [name, value] of Object.entries(entries)) {
    logicalName(name);
    const entry = validateArtifactEntry(value);
    if (destinations.has(entry.relativePath))
      throw new M1ConfigurationError("duplicate-destination", "artifacts");
    destinations.add(entry.relativePath);
    const url = new URL(`${approved.releasePrefix}${entry.relativePath}`, origin);
    assertApprovedDestination(url, origin, approved.releasePrefix);
    snapshot.set(
      name,
      Object.freeze({
        url: url.href,
        mediaType: entry.mediaType,
        bytes: entry.bytes,
        integrity: entry.integrity,
      }),
    );
  }
  return Object.freeze({
    buildId,
    resolve(name: string) {
      const entry = snapshot.get(name);
      if (!entry) throw new M1ConfigurationError("missing-artifact", "logicalName");
      return entry;
    },
  });
}

export function prepareDocumentArtifacts(
  resolver: PublicArtifactResolver,
  plan: DocumentArtifactPlan,
): Readonly<{
  entryScripts: readonly ResolvedPublicArtifact[];
  stylesheets: readonly ResolvedPublicArtifact[];
  windowIntegrity: Readonly<Record<string, string>>;
  importMapJson: string;
}> {
  const input = dataRecord(plan, "documentPlan");
  exactKeys(input, ["buildId", "entryScripts", "windowModules", "stylesheets"], "documentPlan");
  if (input.buildId !== resolver.buildId)
    throw new M1ConfigurationError("document-build-mismatch", "documentPlan.buildId");
  function names(value: unknown): string[] {
    const values = dataArray(value, "documentPlan");
    if (!values.every((name) => typeof name === "string"))
      throw new M1ConfigurationError("invalid-module-list", "documentPlan");
    return [...new Set(values as string[])];
  }
  const modules = names(input.windowModules);
  const entries = names(input.entryScripts);
  if (entries.some((name) => !modules.includes(name)))
    throw new M1ConfigurationError("missing-entry-integrity", "documentPlan.windowModules");
  const windowIntegrity: Record<string, string> = Object.create(null);
  for (const name of modules) {
    const asset = resolver.resolve(name);
    if (!["text/javascript", "application/javascript"].includes(asset.mediaType))
      throw new M1ConfigurationError("invalid-module-type", "documentPlan.windowModules");
    windowIntegrity[asset.url] = asset.integrity;
  }
  const stylesheets = names(input.stylesheets).map((name) => {
    const asset = resolver.resolve(name);
    if (asset.mediaType !== "text/css")
      throw new M1ConfigurationError("invalid-stylesheet-type", "documentPlan.stylesheets");
    return asset;
  });
  // JSON is script data, not HTML-attribute data. Escape independently of path validation.
  const importMapJson = JSON.stringify({ integrity: windowIntegrity }).replace(
    /[<>&\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return Object.freeze({
    entryScripts: Object.freeze(entries.map((name) => resolver.resolve(name))),
    stylesheets: Object.freeze(stylesheets),
    windowIntegrity: Object.freeze(windowIntegrity),
    importMapJson,
  });
}
