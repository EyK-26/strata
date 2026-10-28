import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { RELEASE_PACKAGES } from "./release-packages.ts";
import { resolveReleasePolicy } from "./release-policy.ts";
import { checkReleaseReadiness, type PackageVersion } from "./release-readiness.ts";

interface CandidateSource {
  commit: string;
  repository: string;
  runId: string;
}
interface CandidateArtifact {
  name: string;
  version: string;
  file: string;
  integrity: string;
  manifestSha256: string;
}
interface CandidateLedger {
  schema: 1;
  source: CandidateSource;
  version: string;
  packages: CandidateArtifact[];
}

function validateCandidateSource(source: CandidateSource): void {
  if (
    !source ||
    !/^[a-f0-9]{40}$/.test(source.commit) ||
    !/^[\w.-]+\/[\w.-]+$/.test(source.repository) ||
    !/^[1-9]\d*$/.test(source.runId)
  )
    throw new Error("Invalid candidate source identity.");
}

async function manifestIdentity(root: string, directory: string, name: string) {
  const bytes = await readFile(join(root, directory, "package.json"));
  const manifest = JSON.parse(bytes.toString()) as PackageVersion;
  if (manifest.name !== name)
    throw new Error(`Unexpected candidate manifest identity: ${directory}.`);
  resolveReleasePolicy(manifest.version, "next");
  return {
    metadata: manifest,
    version: manifest.version,
    manifestSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function candidateManifests(root: string) {
  const manifests = await Promise.all(
    RELEASE_PACKAGES.map(([name, directory]) => manifestIdentity(root, directory, name)),
  );
  const readiness = checkReleaseReadiness({
    packages: manifests.map((entry) => entry.metadata),
    channel: "next",
  });
  if (readiness.errors.length) throw new Error(readiness.errors.join("\n"));
  return manifests;
}

async function artifactIntegrity(directory: string, file: string): Promise<string> {
  if (typeof file !== "string" || !/^[a-z0-9][a-z0-9.-]*\.tgz$/.test(file))
    throw new Error("Invalid candidate artifact path.");
  const path = join(directory, file);
  if (!(await lstat(path)).isFile())
    throw new Error("Candidate artifact must be an owned regular file.");
  return `sha512-${createHash("sha512")
    .update(await readFile(path))
    .digest("base64")}`;
}

async function packCandidateArtifacts(
  root: string,
  destination: string,
  source: CandidateSource,
): Promise<CandidateLedger> {
  validateCandidateSource(source);
  const manifests = await candidateManifests(root);
  const version = manifests[0]?.version ?? "";
  if (manifests.some((entry) => entry.version !== version))
    throw new Error("Candidate manifests are not in lockstep.");
  await mkdir(dirname(destination), { recursive: true });
  // Existing attempts are loaded and verified, never silently repacked/overwritten.
  await mkdir(destination);
  const userConfig = join(destination, ".pack-user.npmrc");
  const globalConfig = join(destination, ".pack-global.npmrc");
  await writeFile(userConfig, "", { flag: "wx" });
  await writeFile(globalConfig, "", { flag: "wx" });
  const packages: CandidateArtifact[] = [];
  for (const [index, [name]] of RELEASE_PACKAGES.entries()) {
    const child = Bun.spawn(
      [
        "npm",
        "pack",
        "--workspace",
        name,
        "--pack-destination",
        destination,
        "--json",
        "--ignore-scripts",
        "--cache",
        join(destination, ".npm-cache"),
        "--userconfig",
        userConfig,
        "--globalconfig",
        globalConfig,
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`Candidate pack failed for ${name}: ${stderr}`);
    const result: unknown = JSON.parse(stdout);
    if (
      !Array.isArray(result) ||
      result.length !== 1 ||
      typeof result[0]?.filename !== "string" ||
      result[0]?.name !== name ||
      result[0]?.version !== version
    )
      throw new Error(`Unexpected native pack result for ${name}.`);
    const file = result[0].filename as string;
    packages.push({
      name,
      version,
      file,
      integrity: await artifactIntegrity(destination, file),
      manifestSha256: manifests[index]?.manifestSha256 ?? "",
    });
  }
  const ledger: CandidateLedger = { schema: 1, source, version, packages };
  await writeFile(
    join(destination, "candidate-ledger.json"),
    `${JSON.stringify(ledger, null, 2)}\n`,
    { flag: "wx" },
  );
  return ledger;
}

async function loadCandidateArtifacts(
  root: string,
  directory: string,
  source: CandidateSource,
): Promise<CandidateLedger> {
  validateCandidateSource(source);
  if (!(await lstat(directory)).isDirectory())
    throw new Error("Candidate artifacts require an owned regular directory.");
  const path = join(directory, "candidate-ledger.json");
  if (!(await lstat(path)).isFile()) throw new Error("Candidate ledger must be a regular file.");
  const ledger = JSON.parse(await readFile(path, "utf8")) as CandidateLedger;
  if (
    ledger?.schema !== 1 ||
    ledger.source?.commit !== source.commit ||
    ledger.source?.repository !== source.repository ||
    ledger.source?.runId !== source.runId
  )
    throw new Error("Candidate source identity does not match the selected source run.");
  resolveReleasePolicy(ledger.version, "next");
  if (!Array.isArray(ledger.packages) || ledger.packages.length !== RELEASE_PACKAGES.length)
    throw new Error("Candidate ledger must retain all five artifacts.");
  const manifests = await candidateManifests(root);
  const files = new Set<string>();
  for (const [index, [name]] of RELEASE_PACKAGES.entries()) {
    const artifact = ledger.packages[index];
    if (
      !artifact ||
      artifact.name !== name ||
      artifact.version !== ledger.version ||
      files.has(artifact.file)
    )
      throw new Error("Candidate artifact identity/order is invalid.");
    files.add(artifact.file);
    if (artifact.integrity !== (await artifactIntegrity(directory, artifact.file)))
      throw new Error(`Candidate artifact integrity mismatch for ${name}.`);
    const manifest = manifests[index];
    if (!manifest) throw new Error("Missing candidate manifest.");
    if (manifest.version !== ledger.version || artifact.manifestSha256 !== manifest.manifestSha256)
      throw new Error(`Candidate manifest changed for ${name}.`);
  }
  return ledger;
}

export type { CandidateArtifact, CandidateLedger, CandidateSource };
export {
  loadCandidateArtifacts,
  packCandidateArtifacts,
  RELEASE_PACKAGES,
  validateCandidateSource,
};
