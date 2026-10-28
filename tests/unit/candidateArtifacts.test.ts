import { describe, expect, test } from "bun:test";
import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadCandidateArtifacts,
  packCandidateArtifacts,
} from "../../scripts/candidate-artifacts.ts";
import { planCandidatePublication } from "../../scripts/candidate-publication.ts";
import { verifyCandidateSourceRun } from "../../scripts/candidate-source-run.ts";
import { createReleaseWorkspace, runReleaseFixture } from "../helpers/releaseWorkspace.ts";

const source = { commit: "1".repeat(40), repository: "EyK-26/strata", runId: "123" };

test("the artifact owner refuses a drifting candidate peer before packing", async () => {
  const root = await createReleaseWorkspace();
  try {
    expect(
      (await runReleaseFixture(root, ["scripts/bump.ts", "2.0.0-alpha.0", "--channel", "next"]))
        .code,
    ).toBe(0);
    const path = join(root, "packages/strata-bootstrap/package.json");
    const metadata = JSON.parse(await readFile(path, "utf8"));
    metadata.peerDependencies["@getstrata/core"] = "^2.0.0-alpha.0";
    await writeFile(path, JSON.stringify(metadata));
    const destination = join(root, "candidate");
    await expect(packCandidateArtifacts(root, destination, source)).rejects.toThrow("exactly");
    expect(await Bun.file(join(destination, "candidate-ledger.json")).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native npm packs are retained and an altered artifact or manifest cannot be resumed", async () => {
  const root = await createReleaseWorkspace();
  const destination = join(root, "candidate");
  try {
    expect((await runReleaseFixture(root, ["install", "--ignore-scripts"])).code).toBe(0);
    expect(
      (await runReleaseFixture(root, ["scripts/bump.ts", "2.0.0-alpha.0", "--channel", "next"]))
        .code,
    ).toBe(0);
    const ledger = await packCandidateArtifacts(root, destination, source);
    expect(ledger.packages).toHaveLength(5);
    expect(ledger.version).toBe("2.0.0-alpha.0");
    expect(await loadCandidateArtifacts(root, destination, source)).toEqual(ledger);
    const alias = join(root, "candidate-link");
    await symlink(destination, alias, "dir");
    await expect(loadCandidateArtifacts(root, alias, source)).rejects.toThrow("directory");
    await rm(alias);
    const path = join(destination, ledger.packages[0]?.file ?? "missing");
    const original = await readFile(path);
    await writeFile(path, "corrupted owned artifact");
    await expect(loadCandidateArtifacts(root, destination, source)).rejects.toThrow("integrity");
    await writeFile(path, original);
    const manifestPath = join(root, "packages/strata-core/package.json");
    const manifest = await readFile(manifestPath, "utf8");
    await writeFile(manifestPath, `${manifest}\n`);
    await expect(loadCandidateArtifacts(root, destination, source)).rejects.toThrow("manifest");
    await writeFile(manifestPath, manifest);
    await expect(
      loadCandidateArtifacts(root, destination, { ...source, commit: "2".repeat(40) }),
    ).rejects.toThrow("source");
    const ledgerPath = join(destination, "candidate-ledger.json");
    const altered = {
      ...ledger,
      packages: [{ ...ledger.packages[0], file: "../foreign.tgz" }, ...ledger.packages.slice(1)],
    };
    await writeFile(ledgerPath, JSON.stringify(altered));
    await expect(loadCandidateArtifacts(root, destination, source)).rejects.toThrow("artifact");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

describe("candidate publication recovery identity", () => {
  const artifact = {
    name: "@getstrata/core",
    version: "3.0.0-alpha.0",
    file: "core.tgz",
    integrity: "sha512-owned",
    manifestSha256: "a".repeat(64),
  };
  test("only an authoritative absent version permits a new upload", () => {
    expect(
      planCandidatePublication(artifact, {
        name: artifact.name,
        versions: {},
        "dist-tags": { latest: "2.2.59" },
      }),
    ).toBe("publish");
  });
  test("matching immutable bytes permit resume", () => {
    expect(
      planCandidatePublication(artifact, {
        name: artifact.name,
        versions: {
          [artifact.version]: {
            name: artifact.name,
            version: artifact.version,
            dist: { integrity: artifact.integrity },
          },
        },
      }),
    ).toBe("skip");
  });
  for (const entry of [
    {},
    { name: artifact.name, version: artifact.version },
    { name: artifact.name, version: artifact.version, dist: { integrity: "sha512-foreign" } },
  ]) {
    test(`a published version without matching identity aborts: ${JSON.stringify(entry)}`, () => {
      expect(() =>
        planCandidatePublication(artifact, {
          name: artifact.name,
          versions: { [artifact.version]: entry },
        }),
      ).toThrow("identity");
    });
  }
});

test("resume accepts only the source run and existing trusted workflow in this repository", async () => {
  const metadata = {
    id: 123,
    head_sha: source.commit,
    path: ".github/workflows/release.yml",
    event: "workflow_dispatch",
    repository: { full_name: source.repository },
  };
  const request = async () => Response.json(metadata);
  await expect(verifyCandidateSourceRun(source, request)).resolves.toBeUndefined();
  for (const change of [
    { head_sha: "2".repeat(40) },
    { path: ".github/workflows/foreign.yml" },
    { event: "pull_request" },
    { repository: { full_name: "foreign/repo" } },
    { id: 124 },
  ]) {
    await expect(
      verifyCandidateSourceRun(source, async () => Response.json({ ...metadata, ...change })),
    ).rejects.toThrow("source run");
  }
  await expect(
    verifyCandidateSourceRun(source, async () => new Response("unavailable", { status: 503 })),
  ).rejects.toThrow("source run");
});
