type RegistryRequest = (url: string) => Promise<Response>;
interface PublishedPackageMetadata {
  name: string;
  versions: Record<string, unknown>;
  "dist-tags"?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchPublishedPackageMetadata(
  name: string,
  request: RegistryRequest = fetch,
): Promise<PublishedPackageMetadata> {
  try {
    const response = await request(`https://registry.npmjs.org/${name}`);
    // All five release packages already exist. A 404 is unknown state, not an
    // authoritative empty version map or permission to publish a new package.
    if (!response.ok) throw new Error(`registry returned HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (!isRecord(body) || body.name !== name || !isRecord(body.versions)) {
      throw new Error("registry returned malformed package metadata");
    }
    return { ...body, name, versions: body.versions };
  } catch (cause) {
    throw new Error(`Cannot verify published versions of ${name} in the npm registry.`, { cause });
  }
}

async function fetchPublishedVersions(
  name: string,
  request: RegistryRequest = fetch,
): Promise<string[]> {
  return Object.keys((await fetchPublishedPackageMetadata(name, request)).versions);
}

export type { PublishedPackageMetadata, RegistryRequest };
export { fetchPublishedPackageMetadata, fetchPublishedVersions };
