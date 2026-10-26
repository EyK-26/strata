/** Build-time native file capture and verification. Publication is owned by the chosen provider. */
import { lstat, readFile, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { BuildArtifact } from "bun";
import {
  buildIdentity,
  logicalName,
  type PublicArtifactEntry,
  type PublicArtifactManifest,
  validateArtifactEntry,
} from "./artifactManifest";
import { dataRecord, M1ConfigurationError, relativePath } from "./validation";

export async function collectPublicArtifactManifest(options: {
  buildId: string;
  outputDirectory: string;
  outputs: readonly BuildArtifact[];
  selected: readonly { logicalName: string; outputPath: string }[];
}): Promise<PublicArtifactManifest> {
  const buildId = buildIdentity(options.buildId);
  const root = resolve(options.outputDirectory);
  const canonicalRoot = await realpath(root);
  const outputs = new Map<string, BuildArtifact>();
  for (const artifact of options.outputs) {
    const path = resolve(artifact.path);
    if (outputs.has(path)) throw new M1ConfigurationError("duplicate-output", "outputs");
    outputs.set(path, artifact);
  }
  const artifacts: Record<string, PublicArtifactEntry> = Object.create(null);
  const selected = new Set<string>();
  for (const selection of options.selected) {
    logicalName(selection.logicalName);
    if (
      Object.hasOwn(artifacts, selection.logicalName) ||
      selected.has(resolve(selection.outputPath))
    )
      throw new M1ConfigurationError("duplicate-selection", "selected");
    const path = resolve(selection.outputPath);
    const output = outputs.get(path);
    if (!output || output.kind === "sourcemap")
      throw new M1ConfigurationError("unselected-native-output", "selected");
    const relativeName = relative(root, path).split(sep).join("/");
    relativePath(relativeName, "selected.outputPath");
    if (
      (await realpath(path)) !== resolve(canonicalRoot, relativeName) ||
      (await lstat(path)).isSymbolicLink()
    )
      throw new M1ConfigurationError("symlink-output", "selected.outputPath");
    const bytes = await output.arrayBuffer();
    if (bytes.byteLength !== output.size)
      throw new M1ConfigurationError("native-output-changed", "selected.outputPath");
    const actual = await readFile(path);
    if (!Buffer.from(bytes).equals(actual))
      throw new M1ConfigurationError("native-output-changed", "selected.outputPath");
    artifacts[selection.logicalName] = validateArtifactEntry({
      relativePath: relativeName,
      mediaType: output.type.split(";")[0],
      bytes: bytes.byteLength,
      integrity: `sha256-${new Bun.CryptoHasher("sha256").update(bytes).digest("base64")}`,
    });
    selected.add(path);
  }
  return Object.freeze({ format: 1, buildId, artifacts: Object.freeze(artifacts) });
}

/** Verify against the retained manifest immediately before provider publication.
 * A fresh collection cannot recover bytes changed before their first capture. */
export async function verifyPublicArtifactFiles(
  manifest: PublicArtifactManifest,
  outputDirectory: string,
): Promise<void> {
  const root = await realpath(outputDirectory);
  for (const value of Object.values(dataRecord(manifest.artifacts, "artifacts"))) {
    const entry = validateArtifactEntry(value);
    const path = resolve(root, entry.relativePath);
    if ((await realpath(path)) !== path || (await lstat(path)).isSymbolicLink())
      throw new M1ConfigurationError("symlink-output", "artifact.relativePath");
    const bytes = await readFile(path);
    if (
      bytes.byteLength !== entry.bytes ||
      `sha256-${new Bun.CryptoHasher("sha256").update(bytes).digest("base64")}` !== entry.integrity
    )
      throw new M1ConfigurationError("native-output-changed", "artifact.relativePath");
  }
}
