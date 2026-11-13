import { describe, expect, test } from "bun:test";
import {
  archiveIntegrity,
  assertReleaseProvenanceSource,
  registryDisposition,
} from "../../scripts/release-publication.ts";
import { type CIRun, hasAcceptedCI } from "../../scripts/verify-release-ci.ts";

const archive = {
  name: "@getstrata/core",
  version: "3.0.0",
  file: "core.tgz",
  integrity: archiveIntegrity(new TextEncoder().encode("immutable")),
};
describe("immutable publication recovery", () => {
  test("only authoritative absence allows publication", () => {
    expect(registryDisposition({ name: archive.name, versions: {} }, archive)).toBe("publish");
    for (const invalid of [
      null,
      [],
      {},
      { name: archive.name },
      { name: "other", versions: {} },
      { name: archive.name, versions: [] },
    ]) {
      expect(() => registryDisposition(invalid, archive)).toThrow();
    }
  });
  test("existing versions must match archive integrity", () => {
    expect(
      registryDisposition(
        { name: archive.name, versions: { "3.0.0": { dist: { integrity: archive.integrity } } } },
        archive,
      ),
    ).toBe("verified");
    for (const existing of [{}, null, { dist: {} }, { dist: { integrity: "sha512-other" } }]) {
      expect(() =>
        registryDisposition({ name: archive.name, versions: { "3.0.0": existing } }, archive),
      ).toThrow();
    }
  });
  test("byte changes invalidate identity", () => {
    expect(archiveIntegrity(new TextEncoder().encode("changed"))).not.toBe(archive.integrity);
  });
});
describe("release CI admission", () => {
  const accepted: CIRun = {
    head_sha: "a".repeat(40),
    head_branch: "main",
    event: "push",
    status: "completed",
    conclusion: "success",
  };
  test("requires completed successful main push at exact source commit", () => {
    expect(hasAcceptedCI([accepted], accepted.head_sha)).toBe(true);
    expect(hasAcceptedCI([], accepted.head_sha)).toBe(false);
    for (const change of [
      { head_sha: "b".repeat(40) },
      { head_branch: "feature" },
      { event: "pull_request" },
      { status: "in_progress" },
      { conclusion: "failure" },
      { conclusion: null },
    ]) {
      expect(hasAcceptedCI([{ ...accepted, ...change }], accepted.head_sha)).toBe(false);
    }
  });
});

test("actual publication CLI validates all registry states before any npm mutation", async () => {
  const { mkdtemp, readFile, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { releasePackages } = await import("../../scripts/release-publication.ts");
  const root = join(import.meta.dir, "../..");
  const fixture = await mkdtemp(join(tmpdir(), "strata-publish-preflight-"));
  try {
    const packages = await Promise.all(
      releasePackages.map(async (name) =>
        JSON.parse(await readFile(join(root, `packages/${name}/package.json`), "utf8")),
      ),
    );
    const commit = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root })
      .stdout.toString()
      .trim();
    const archives = [];
    for (const [index, pkg] of packages.entries()) {
      const file = `fixture-${index}.tgz`;
      const bytes = new TextEncoder().encode(`archive-${index}`);
      await writeFile(join(fixture, file), bytes);
      archives.push({
        name: pkg.name,
        version: pkg.version,
        file,
        integrity: archiveIntegrity(bytes),
      });
    }
    await writeFile(
      join(fixture, "manifest.json"),
      JSON.stringify({ commit, tag: `v${packages[0].version}`, archives }),
    );
    const marker = join(fixture, "npm-called");
    await writeFile(join(fixture, "npm"), `#!/bin/sh\nprintf called > '${marker}'\nexit 1\n`, {
      mode: 0o755,
    });
    const preload = join(fixture, "registry.ts");
    // The fifth lookup fails after four authoritative absences: no partial publish is allowed.
    await writeFile(
      preload,
      `let calls = 0; globalThis.fetch = (async (url) => { calls++; if (calls === 5) return new Response("unavailable", { status: 503 }); return Response.json({ name: String(url).replace("https://registry.npmjs.org/", ""), versions: {} }); }) as typeof fetch;`,
    );
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--preload",
        preload,
        "scripts/release-publication.ts",
        "publish",
        fixture,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          RELEASE_TAG: `v${packages[0].version}`,
          PATH: `${fixture}:${process.env.PATH}`,
        },
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Unknown registry state");
    expect(await Bun.file(marker).exists()).toBe(false);
    await writeFile(join(fixture, archives[0]?.file ?? "missing.tgz"), "tampered");
    const tampered = Bun.spawnSync(
      [
        process.execPath,
        "--preload",
        preload,
        "scripts/release-publication.ts",
        "publish",
        fixture,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          RELEASE_TAG: `v${packages[0].version}`,
          PATH: `${fixture}:${process.env.PATH}`,
        },
      },
    );
    expect(tampered.exitCode).toBe(1);
    expect(tampered.stderr.toString()).toContain("Archive hash mismatch");
    expect(await Bun.file(marker).exists()).toBe(false);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("Actions provenance refuses a dispatch source different from the checked-out tag", () => {
  const commit = "a".repeat(40);
  expect(() =>
    assertReleaseProvenanceSource(commit, { GITHUB_ACTIONS: "true", GITHUB_SHA: commit }),
  ).not.toThrow();
  for (const sha of [undefined, "b".repeat(40), "", `${commit}\n`])
    expect(() =>
      assertReleaseProvenanceSource(commit, { GITHUB_ACTIONS: "true", GITHUB_SHA: sha }),
    ).toThrow("provenance source");
  expect(() => assertReleaseProvenanceSource(commit, {})).not.toThrow();
});
