import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sourceRoot = join(import.meta.dir, "../..");
const names = ["core", "bootstrap", "cli", "starter", "create-strata"];

async function createReleaseWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "strata-channel-bump-"));
  const write = async (path: string, value: string) => {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), value);
  };
  await cp(join(sourceRoot, "scripts"), join(root, "scripts"), { recursive: true });
  await write(
    "package.json",
    JSON.stringify({
      name: "strata-channel-fixture",
      private: true,
      workspaces: ["packages/*"],
      dependencies: Object.fromEntries(
        names.map((name) => [
          name === "create-strata" ? name : `@getstrata/${name}`,
          "workspace:*",
        ]),
      ),
    }),
  );
  for (const name of names) {
    const directory = name === "create-strata" ? name : `strata-${name}`;
    const published = name === "create-strata" ? name : `@getstrata/${name}`;
    const peers =
      name === "bootstrap"
        ? { "@getstrata/core": "^1.0.0" }
        : name === "cli"
          ? { "@getstrata/core": "^1.0.0", "@getstrata/bootstrap": "^1.0.0" }
          : {};
    await write(
      `packages/${directory}/package.json`,
      JSON.stringify({ name: published, version: "1.0.0", peerDependencies: peers }, null, 2),
    );
    if (name !== "create-strata")
      await write(`packages/${directory}/CHANGELOG.md`, `# ${published}\n\n## 1.0.0\n`);
  }
  await write("README.md", "Published as **1.0.0**");
  await write(
    "scripts/verify-package-versions.ts",
    `const EXPECTED: Record<string, string> = {\n  "@getstrata/core": "1.0.0",\n};`,
  );
  for (const path of [
    "packages/strata-starter/templates/package.json",
    "tests/unit/cli/starterGenerate.test.ts",
    "tests/unit/cli/starterTemplate.test.ts",
  ]) {
    await write(path, '{"@getstrata/core": "^1.0.0"}');
  }
  for (const path of ["renderProjectMetadata.ts", "types.ts"]) {
    await write(
      `packages/strata-starter/src/${path}`,
      await readFile(join(sourceRoot, "packages/strata-starter/src", path), "utf8"),
    );
  }
  return root;
}

async function runReleaseFixture(root: string, args: string[]) {
  const child = Bun.spawn([process.execPath, "--no-env-file", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

export { createReleaseWorkspace, runReleaseFixture };
