import { fetchPublishedVersions } from "./published-package-versions.ts";
import { parseStableVersion } from "./stable-version.ts";

async function packagePublicationStatus(
  name: string,
  version: string,
): Promise<"published" | "unpublished"> {
  if (!name || !parseStableVersion(version)) {
    throw new Error("Publication requires a package name and canonical stable version.");
  }
  const versions = await fetchPublishedVersions(name);
  return versions.includes(version) ? "published" : "unpublished";
}

if (import.meta.main) {
  try {
    const [name, version, ...extra] = process.argv.slice(2);
    if (!name || !version || extra.length !== 0) {
      throw new Error("Usage: bun scripts/package-publication-status.ts <name> <stable-version>");
    }
    console.log(await packagePublicationStatus(name, version));
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Cannot verify package publication state.",
    );
    process.exitCode = 1;
  }
}

export { packagePublicationStatus };
