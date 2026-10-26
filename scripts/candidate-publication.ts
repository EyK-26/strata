import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CandidateArtifact,
  type CandidateSource,
  loadCandidateArtifacts,
} from "./candidate-artifacts.ts";
import {
  fetchPublishedPackageMetadata,
  type PublishedPackageMetadata,
  type RegistryRequest,
} from "./published-package-versions.ts";
import { resolveReleasePolicy } from "./release-policy.ts";

function planCandidatePublication(
  artifact: CandidateArtifact,
  metadata: PublishedPackageMetadata,
): "publish" | "skip" {
  if (metadata.name !== artifact.name)
    throw new Error("Candidate registry package identity mismatch.");
  if (!Object.hasOwn(metadata.versions, artifact.version)) return "publish";
  const entry = metadata.versions[artifact.version] as {
    name?: string;
    version?: string;
    dist?: { integrity?: string };
  } | null;
  if (
    !entry ||
    entry.name !== artifact.name ||
    entry.version !== artifact.version ||
    entry.dist?.integrity !== artifact.integrity
  )
    throw new Error(
      `Published candidate identity mismatch for ${artifact.name}@${artifact.version}.`,
    );
  return "skip";
}

function candidatePointers(metadata: PublishedPackageMetadata): { latest?: string; next?: string } {
  const tags = metadata["dist-tags"];
  if (typeof tags !== "object" || tags === null || Array.isArray(tags))
    throw new Error("Cannot verify candidate channel pointers.");
  const pointers = tags as Record<string, unknown>;
  for (const name of ["latest", "next"]) {
    if (
      pointers[name] !== undefined &&
      (typeof pointers[name] !== "string" || pointers[name] === "")
    )
      throw new Error("Cannot verify candidate channel pointers.");
  }
  return {
    latest: pointers.latest as string | undefined,
    next: pointers.next as string | undefined,
  };
}

async function publishCandidate(
  root: string,
  directory: string,
  source: CandidateSource,
  attempt: string,
  request: RegistryRequest,
  publishExecutable: string,
): Promise<void> {
  if (!/^[1-9]\d*-[1-9]\d*$/.test(attempt)) throw new Error("Invalid candidate attempt identity.");
  const ledger = await loadCandidateArtifacts(root, directory, source);
  const policy = resolveReleasePolicy(ledger.version, "next");
  const receipt = {
    source,
    version: ledger.version,
    attempt,
    outcome: "incomplete" as "incomplete" | "success",
    before: [] as Array<{ name: string; latest?: string; next?: string }>,
    attempted: [] as string[],
    completed: [] as string[],
    skipped: [] as string[],
    verified: [] as string[],
    failure: undefined as string | undefined,
  };
  const path = join(directory, `publication-${attempt}.json`);
  const save = () => writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  try {
    // Verify all five before attempting the first upload. Unknown state is not absence.
    for (const artifact of ledger.packages) {
      const metadata = await fetchPublishedPackageMetadata(artifact.name, request);
      planCandidatePublication(artifact, metadata);
      receipt.before.push({ name: artifact.name, ...candidatePointers(metadata) });
    }
    await save();
    for (const [index, artifact] of ledger.packages.entries()) {
      const before = receipt.before[index];
      const current = await fetchPublishedPackageMetadata(artifact.name, request);
      const pointers = candidatePointers(current);
      if (!before || pointers.latest !== before.latest || pointers.next !== before.next)
        throw new Error(
          `Candidate channel pointer changed before ${artifact.name}; stop for ownership review.`,
        );
      if (planCandidatePublication(artifact, current) === "skip")
        receipt.skipped.push(artifact.name);
      else {
        await loadCandidateArtifacts(root, directory, source);
        receipt.attempted.push(artifact.name);
        await save();
        const child = Bun.spawn(
          [
            publishExecutable,
            "publish",
            join(directory, artifact.file),
            "--tag",
            policy.npmTag,
            "--access",
            "public",
            "--provenance",
            "--ignore-scripts",
          ],
          { cwd: root, stdout: "inherit", stderr: "inherit" },
        );
        if ((await child.exited) !== 0)
          throw new Error(`Candidate upload failed for ${artifact.name}.`);
        receipt.completed.push(artifact.name);
        await save();
      }
      const published = await fetchPublishedPackageMetadata(artifact.name, request);
      const after = candidatePointers(published);
      if (
        planCandidatePublication(artifact, published) !== "skip" ||
        after.next !== ledger.version ||
        after.latest !== before.latest
      )
        throw new Error(
          `Candidate artifact or channel pointer verification failed for ${artifact.name}.`,
        );
      receipt.verified.push(artifact.name);
      await save();
    }
    // A later upload must not turn earlier per-package verification into a global success.
    for (const [index, artifact] of ledger.packages.entries()) {
      const metadata = await fetchPublishedPackageMetadata(artifact.name, request);
      const pointers = candidatePointers(metadata);
      if (
        planCandidatePublication(artifact, metadata) !== "skip" ||
        pointers.next !== ledger.version ||
        pointers.latest !== receipt.before[index]?.latest
      )
        throw new Error(`Final candidate pointer verification failed for ${artifact.name}.`);
    }
    receipt.outcome = "success";
    await save();
  } catch (error) {
    receipt.failure = error instanceof Error ? error.message : "Candidate publication failed.";
    try {
      await save();
    } catch (recordError) {
      throw new AggregateError(
        [error, recordError],
        "Candidate publication and receipt write failed.",
      );
    }
    throw error;
  }
}

export { planCandidatePublication, publishCandidate };
