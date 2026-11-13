import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertReleaseProvenanceSource } from "../../scripts/release-publication.ts";

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

test("workspace publication preflights all versions and accepts delayed registry visibility", async () => {
  const root = join(import.meta.dir, "../..");
  const fixture = await mkdtemp(join(tmpdir(), "strata-workspace-publish-"));
  const names = [
    "@getstrata/core",
    "@getstrata/bootstrap",
    "@getstrata/cli",
    "@getstrata/starter",
    "create-strata",
  ];
  const version = JSON.parse(
    await readFile(join(root, "packages/strata-core/package.json"), "utf8"),
  ).version;
  try {
    await symlink(join(root, "packages"), join(fixture, "packages"));
    const bin = join(fixture, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "git"), `#!/bin/sh\nprintf '%s' '${"a".repeat(40)}'\n`, {
      mode: 0o755,
    });
    const calls = join(fixture, "npm.jsonl");
    const lookups = join(fixture, "lookups.jsonl");
    await writeFile(
      join(bin, "npm"),
      `#!${process.execPath}\nimport {appendFileSync} from 'node:fs'; const args=process.argv.slice(2); appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n'); if(args[2]===process.env.FAIL_WORKSPACE)process.exit(1);`,
      { mode: 0o755 },
    );
    for (const scenario of [
      "pending",
      "partial",
      "all-existing",
      "registry-failure",
      "npm-failure",
      "dry-run",
    ]) {
      await writeFile(calls, "");
      await writeFile(lookups, "");
      const preload = join(fixture, "registry.ts");
      await writeFile(
        preload,
        `import {appendFileSync} from 'node:fs'; let count=0;
        globalThis.fetch=async (url)=>{ count++; appendFileSync(${JSON.stringify(lookups)},JSON.stringify(url)+'\\n');
        if(${JSON.stringify(scenario)}==='dry-run'||count>5)throw new Error('Unexpected registry lookup after publication');
        const name=String(url).replace('https://registry.npmjs.org/','');
        if(${JSON.stringify(scenario)}==='registry-failure'&&name==='create-strata')return new Response('unavailable',{status:503});
        const exists=${JSON.stringify(scenario)}==='all-existing'||(${JSON.stringify(scenario)}==='partial'&&name==='@getstrata/core');
        return Response.json({name,versions:exists?{[${JSON.stringify(version)}]:{}}:{}}); };`,
      );
      const result = Bun.spawnSync(
        [
          process.execPath,
          "--preload",
          preload,
          join(root, "scripts/release-publication.ts"),
          scenario === "dry-run" ? "dry-run" : "publish",
        ],
        {
          cwd: fixture,
          env: {
            ...process.env,
            GITHUB_ACTIONS: "false",
            RELEASE_TAG: `v${version}`,
            PATH: `${bin}:${process.env.PATH}`,
            FAIL_WORKSPACE: scenario === "npm-failure" ? names[1] : "",
          },
        },
      );
      const invocations = (await readFile(calls, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const requested = (await readFile(lookups, "utf8")).trim().split("\n").filter(Boolean);
      expect(requested.length).toBe(scenario === "dry-run" ? 0 : 5);
      expect(result.exitCode).toBe(["registry-failure", "npm-failure"].includes(scenario) ? 1 : 0);
      const expectedNames =
        scenario === "registry-failure" || scenario === "all-existing"
          ? []
          : scenario === "partial"
            ? names.slice(1)
            : scenario === "npm-failure"
              ? names.slice(0, 2)
              : names;
      expect(invocations).toEqual(
        expectedNames.map((name) => [
          "publish",
          "--workspace",
          name,
          "--access",
          "public",
          "--tag",
          "latest",
          "--provenance",
          ...(scenario === "dry-run" ? ["--dry-run", "--ignore-scripts"] : []),
        ]),
      );
      if (scenario === "pending")
        expect(result.stdout.toString()).toContain("npm accepted publication");
      if (scenario === "registry-failure")
        expect(result.stderr.toString()).toContain("Cannot verify published versions");
      if (scenario === "npm-failure")
        expect(result.stderr.toString()).toContain("npm publish failed");
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
