import { dataRecord, exactKeys, M1ConfigurationError, relativePath } from "./validation";

export type PublicArtifactEntry = Readonly<{
  relativePath: string;
  mediaType: string;
  bytes: number;
  integrity: string;
}>;
export type PublicArtifactManifest = Readonly<{
  format: 1;
  buildId: string;
  artifacts: Readonly<Record<string, PublicArtifactEntry>>;
}>;
export function buildIdentity(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value))
    throw new M1ConfigurationError("invalid-build", "buildId");
  return value;
}

export function logicalName(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value))
    throw new M1ConfigurationError("invalid-name", "artifacts");
}

export function validateArtifactEntry(value: unknown): PublicArtifactEntry {
  const entry = dataRecord(value, "artifact");
  exactKeys(entry, ["relativePath", "mediaType", "bytes", "integrity"], "artifact");
  const path = relativePath(entry.relativePath, "artifact.relativePath");
  if (
    path.endsWith(".map") ||
    typeof entry.mediaType !== "string" ||
    !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(entry.mediaType) ||
    entry.mediaType === "text/html"
  )
    throw new M1ConfigurationError("invalid-media-type", "artifact.mediaType");
  if (typeof entry.bytes !== "number" || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0)
    throw new M1ConfigurationError("invalid-byte-count", "artifact.bytes");
  if (
    typeof entry.integrity !== "string" ||
    !/^sha256-[A-Za-z0-9+/]{43}=$/.test(entry.integrity) ||
    Buffer.from(entry.integrity.slice(7), "base64").toString("base64") !== entry.integrity.slice(7)
  )
    throw new M1ConfigurationError("invalid-digest", "artifact.integrity");
  return Object.freeze({
    relativePath: path,
    mediaType: entry.mediaType,
    bytes: entry.bytes,
    integrity: entry.integrity,
  });
}
