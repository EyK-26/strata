import { expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createReleaseWorkspace, runReleaseFixture } from "../helpers/releaseWorkspace.ts";

test("native stable CLI preserves flag-shaped changelog prose", async () => {
  const root = await createReleaseWorkspace();
  try {
    for (const [index, notes] of ["--channel", "--promote", "--channel=next"].entries()) {
      const version = `1.0.${index + 1}`;
      const result = await runReleaseFixture(root, ["scripts/bump.ts", version, "--notes", notes]);
      expect(result.code, result.stderr).toBe(0);
      expect(await readFile(join(root, "packages/strata-core/CHANGELOG.md"), "utf8")).toContain(
        `## ${version}\n\n${notes}`,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native official bump stages exact candidate peers/generation and explicit stable promotion", async () => {
  const root = await createReleaseWorkspace();
  const run = async (args: string[]) => {
    const result = await runReleaseFixture(root, args);
    expect(result.code, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`).toBe(0);
    return result;
  };
  const manifest = join(root, "packages/strata-core/package.json");
  const assertPins = async (version: string, pin: string) => {
    for (const name of [
      "strata-core",
      "strata-bootstrap",
      "strata-cli",
      "strata-starter",
      "create-strata",
    ]) {
      const metadata = JSON.parse(
        await readFile(join(root, "packages", name, "package.json"), "utf8"),
      );
      expect(metadata.version).toBe(version);
      for (const range of Object.values(metadata.peerDependencies ?? {})) expect(range).toBe(pin);
    }
    const generated = await run([
      "-e",
      'const {renderPackageJson}=await import("./packages/strata-starter/src/renderProjectMetadata.ts"); console.log(renderPackageJson("owned-candidate"));',
    ]);
    const metadata = JSON.parse(generated.stdout);
    for (const name of ["core", "bootstrap", "cli"])
      expect(metadata.dependencies[`@getstrata/${name}`]).toBe(pin);
    expect(metadata.dependencies.eta).toBe("^4.6.0");
    expect(metadata.engines.bun).toBe(">=1.4.4");
    for (const file of [
      "tests/unit/cli/starterGenerate.test.ts",
      "tests/unit/cli/starterTemplate.test.ts",
    ]) {
      expect(await readFile(join(root, file), "utf8")).toContain(`"${pin}"`);
    }
    const lock = await readFile(join(root, "bun.lock"), "utf8");
    await run(["install", "--frozen-lockfile", "--ignore-scripts"]);
    await run(["dedupe"]);
    expect(await readFile(join(root, "bun.lock"), "utf8")).toBe(lock);
  };
  try {
    await run(["install", "--ignore-scripts"]);
    const before = await readFile(manifest, "utf8");
    await run(["scripts/bump.ts", "2.0.0-alpha.0", "--channel", "next", "--check"]);
    expect(await readFile(manifest, "utf8")).toBe(before);
    for (const version of ["2.0.0-alpha.0", "2.0.0-alpha.1"]) {
      await run([
        "scripts/bump.ts",
        version,
        "--channel",
        "next",
        "--notes",
        "Owned candidate fixture.",
      ]);
      await assertPins(version, version);
      await run(["scripts/verify-release-ready.ts", "--channel", "next"]);
      const unchanged = await readFile(manifest, "utf8");
      expect(
        (
          await run([
            "scripts/bump.ts",
            version,
            "--channel",
            "next",
            "--check",
            "--notes",
            "Owned candidate fixture.",
          ])
        ).stdout,
      ).toContain("Nothing to change");
      for (const invalid of ["2.0.0-alpha.01", "2.0.0", "1.0.0-alpha.0"]) {
        expect(
          (await runReleaseFixture(root, ["scripts/bump.ts", invalid, "--channel", "next"])).code,
        ).not.toBe(0);
        expect(await readFile(manifest, "utf8")).toBe(unchanged);
      }
      expect((await runReleaseFixture(root, ["scripts/bump.ts", "2.0.0"])).code).not.toBe(0);
      expect(await readFile(manifest, "utf8")).toBe(unchanged);
    }
    await run(["scripts/bump.ts", "2.0.0", "--channel", "stable", "--promote"]);
    await assertPins("2.0.0", "^2.0.0");
    await run(["scripts/verify-release-ready.ts"]);
    expect(await readFile(join(root, "packages/strata-core/CHANGELOG.md"), "utf8")).toContain(
      "## 2.0.0-alpha.0",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
