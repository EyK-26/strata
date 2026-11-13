import { describe, expect, test } from "bun:test";
import {
  archiveIntegrity,
  assertReleaseProvenanceSource,
  packedArchive,
  registryDisposition,
} from "../../scripts/release-publication.ts";

const archive = {
  name: "@getstrata/core",
  version: "3.0.0",
  file: "core.tgz",
  integrity: archiveIntegrity(new TextEncoder().encode("immutable")),
};
describe("npm pack output", () => {
  const entry = { ...archive, filename: archive.file };
  test("accepts npm 11 arrays and npm 12 package-keyed records", () => {
    expect(packedArchive([entry], archive)).toEqual(archive);
    expect(packedArchive({ [archive.name]: entry }, archive)).toEqual(archive);
  });
  test("rejects ambiguous, missing, mismatched or unsafe archive identities", () => {
    for (const invalid of [
      null,
      {},
      [],
      [entry, entry],
      { [archive.name]: entry, other: entry },
      { other: entry },
      [null],
      [{ ...entry, name: "other" }],
      [{ ...entry, version: "0.0.0" }],
      [{ ...entry, filename: "../outside.tgz" }],
      [{ ...entry, filename: "/outside.tgz" }],
      [{ ...entry, filename: "archive.zip" }],
      [{ ...entry, filename: null }],
      [{ ...entry, integrity: undefined }],
      [{ ...entry, integrity: "sha512-invalid" }],
    ]) {
      expect(() => packedArchive(invalid, archive)).toThrow();
    }
  });
});
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

test("publication and dry-run resolve default and relative archive directories to local files", async () => {
  const { mkdtemp, mkdir, readFile, writeFile, rm, symlink } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const { releasePackages } = await import("../../scripts/release-publication.ts");
  const root = join(import.meta.dir, "../..");
  const fixture = await mkdtemp(join(tmpdir(), "strata-publish-local-"));
  try {
    const packages = await Promise.all(
      releasePackages.map(async (name) =>
        JSON.parse(await readFile(join(root, `packages/${name}/package.json`), "utf8")),
      ),
    );
    const commit = "a".repeat(40);
    await symlink(join(root, "packages"), join(fixture, "packages"));
    const bin = join(fixture, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "git"), `#!/bin/sh\nprintf '%s' '${commit}'\n`, { mode: 0o755 });
    const calls = join(fixture, "calls.jsonl");
    await writeFile(
      join(bin, "npm"),
      `#!${process.execPath}\nimport { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2))+'\\n');`,
      { mode: 0o755 },
    );
    for (const mode of ["publish", "dry-run"]) {
      for (const requestedDirectory of [
        undefined,
        "nested archives/output",
        join(fixture, "absolute"),
      ]) {
        const directory = resolve(fixture, requestedDirectory ?? "release-archives");
        await mkdir(directory, { recursive: true });
        const archives = [];
        for (const [index, pkg] of packages.entries()) {
          const bytes = new TextEncoder().encode(`archive-${index}`);
          const file = `fixture-${index}.tgz`;
          await writeFile(join(directory, file), bytes);
          archives.push({
            name: pkg.name,
            version: pkg.version,
            file,
            integrity: archiveIntegrity(bytes),
          });
        }
        await writeFile(
          join(directory, "manifest.json"),
          JSON.stringify({ commit, tag: `v${packages[0].version}`, archives }),
        );
        await writeFile(calls, "");
        const preload = join(fixture, "registry.ts");
        await writeFile(
          preload,
          mode === "dry-run"
            ? 'globalThis.fetch = async () => { throw new Error("Dry-run must not query publication state"); };'
            : `const archives=${JSON.stringify(archives)}; let calls=0; globalThis.fetch=async (url)=>{ const archive=archives.find(a=>String(url)==='https://registry.npmjs.org/'+a.name); const published=calls++>=archives.length; return Response.json({name:archive.name,versions:published?{[archive.version]:{dist:{integrity:archive.integrity}}}:{}}); };`,
        );
        const result = Bun.spawnSync(
          [
            process.execPath,
            "--preload",
            preload,
            join(root, "scripts/release-publication.ts"),
            mode,
            ...(requestedDirectory === undefined ? [] : [requestedDirectory]),
          ],
          {
            cwd: fixture,
            env: {
              ...process.env,
              GITHUB_ACTIONS: "false",
              RELEASE_TAG: `v${packages[0].version}`,
              PATH: `${bin}:${process.env.PATH}`,
            },
          },
        );
        expect(result.exitCode).toBe(0);
        expect(result.stderr.toString()).toBe("");
        const invocations = (await readFile(calls, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        expect(invocations).toHaveLength(packages.length);
        for (const [index, args] of invocations.entries()) {
          expect(args).toEqual([
            "publish",
            join(directory, `fixture-${index}.tgz`),
            "--access",
            "public",
            "--tag",
            "latest",
            "--provenance",
            ...(mode === "dry-run" ? ["--dry-run", "--ignore-scripts"] : []),
          ]);
        }
      }
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
