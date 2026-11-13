import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkReleaseReadiness } from "./release-readiness.ts";

export const releasePackages = [
  "strata-core",
  "strata-bootstrap",
  "strata-cli",
  "strata-starter",
  "create-strata",
];
export interface Archive {
  name: string;
  version: string;
  file: string;
  integrity: string;
}
interface Manifest {
  commit: string;
  tag: string;
  archives: Archive[];
}
export function assertReleaseProvenanceSource(
  commit: string,
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (environment.GITHUB_ACTIONS === "true" && environment.GITHUB_SHA !== commit) {
    throw new Error(
      "GitHub provenance source does not match the checked-out release commit. Dispatch this workflow at the release tag ref.",
    );
  }
}
export function archiveIntegrity(bytes: Uint8Array): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}
export function registryDisposition(metadata: unknown, archive: Archive): "publish" | "verified" {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    throw new Error(`Invalid registry metadata: ${archive.name}`);
  const value = metadata as { name?: unknown; versions?: unknown };
  if (
    value.name !== archive.name ||
    !value.versions ||
    typeof value.versions !== "object" ||
    Array.isArray(value.versions)
  )
    throw new Error(`Invalid registry versions: ${archive.name}`);
  const existing = (value.versions as Record<string, { dist?: { integrity?: string } }>)[
    archive.version
  ];
  if (existing === undefined) return "publish";
  if (existing?.dist?.integrity !== archive.integrity)
    throw new Error(
      `Published archive differs or lacks integrity: ${archive.name}@${archive.version}`,
    );
  return "verified";
}
async function command(args: string[]): Promise<string> {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "inherit" });
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) throw new Error(`Command failed: ${args[0]} ${args[1]}`);
  return output.trim();
}
async function registry(archive: Archive): Promise<unknown> {
  const response = await fetch(`https://registry.npmjs.org/${archive.name}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`Unknown registry state for ${archive.name}: HTTP ${response.status}`);
  return response.json();
}
async function main() {
  const [mode, directory = "release-archives"] = process.argv.slice(2);
  const tag = process.env.RELEASE_TAG ?? "";
  const commit = await command(["git", "rev-parse", "HEAD"]);
  assertReleaseProvenanceSource(commit, process.env);
  const packages = await Promise.all(
    releasePackages.map(async (name) =>
      JSON.parse(await readFile(`packages/${name}/package.json`, "utf8")),
    ),
  );
  const readiness = checkReleaseReadiness({ packages, tag });
  if (readiness.errors.length) throw new Error(readiness.errors.join("\n"));
  if (mode === "pack") {
    await mkdir(directory, { recursive: true });
    const archives: Archive[] = [];
    for (let index = 0; index < releasePackages.length; index++) {
      const result = JSON.parse(
        await command([
          "npm",
          "pack",
          `./packages/${releasePackages[index]}`,
          "--json",
          "--pack-destination",
          directory,
        ]),
      );
      if (result.length !== 1) throw new Error("Expected exactly one packed archive");
      const file = result[0].filename;
      archives.push({
        name: packages[index].name,
        version: packages[index].version,
        file,
        integrity: archiveIntegrity(await readFile(join(directory, file))),
      });
    }
    await writeFile(
      join(directory, "manifest.json"),
      `${JSON.stringify({ commit, tag, archives }, null, 2)}\n`,
    );
    return;
  }
  if (mode !== "publish")
    throw new Error("Usage: release-publication.ts pack|publish [archive-directory]");
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as Manifest;
  if (
    manifest.commit !== commit ||
    manifest.tag !== tag ||
    manifest.archives.length !== packages.length
  )
    throw new Error("Archive manifest does not match release source");
  // Validate the entire archive set and every registry state before the first mutation.
  const actions = [];
  for (const [index, archive] of manifest.archives.entries()) {
    if (
      archive.name !== packages[index].name ||
      archive.version !== packages[index].version ||
      !/^[a-zA-Z0-9_.-]+\.tgz$/.test(archive.file)
    )
      throw new Error("Unexpected archive identity");
    if (archiveIntegrity(await readFile(join(directory, archive.file))) !== archive.integrity)
      throw new Error(`Archive hash mismatch: ${archive.file}`);
    actions.push(registryDisposition(await registry(archive), archive));
  }
  for (const [index, archive] of manifest.archives.entries()) {
    if (actions[index] === "publish")
      await command([
        "npm",
        "publish",
        join(directory, archive.file),
        "--access",
        "public",
        "--tag",
        "latest",
        "--provenance",
      ]);
    // Verify after every publication; a failure leaves recoverable immutable artifacts.
    if (registryDisposition(await registry(archive), archive) !== "verified")
      throw new Error(`Publication not visible: ${archive.name}`);
    console.log(`Verified ${archive.name}@${archive.version}: ${archive.integrity}`);
  }
}
if (import.meta.main) await main();
