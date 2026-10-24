import { expect, test } from "bun:test";

const manifests = [
  "package.json",
  ...["core", "bootstrap", "cli", "starter"].map((name) => `packages/strata-${name}/package.json`),
  "packages/create-strata/package.json",
  "packages/strata-starter/templates/package.json",
  "templates/scaffold/spa-react/frontend/package.json",
];

test("all active package requirements reject Bun 1.4.3 and allow 1.4.4 plus future 1.4 patches", async () => {
  for (const path of manifests) {
    const manifest = await Bun.file(new URL(`../../${path}`, import.meta.url)).json();
    expect(Bun.semver.satisfies("1.4.3", manifest.engines.bun), path).toBe(false);
    expect(Bun.semver.satisfies("1.4.4", manifest.engines.bun), path).toBe(true);
    expect(Bun.semver.satisfies("1.4.999", manifest.engines.bun), path).toBe(true);
    if (manifest.devDependencies?.["@types/bun"]) {
      expect(Bun.semver.satisfies("1.4.3", manifest.devDependencies["@types/bun"]), path).toBe(
        false,
      );
      expect(Bun.semver.satisfies("1.4.4", manifest.devDependencies["@types/bun"]), path).toBe(
        true,
      );
      expect(Bun.semver.satisfies("1.4.3", manifest.overrides["bun-types"]), path).toBe(false);
      expect(Bun.semver.satisfies("1.4.4", manifest.overrides["bun-types"]), path).toBe(true);
    }
  }
});

test("the qualified repository runtime and framework Docker stages use the same supported patch", async () => {
  const version = (await Bun.file(new URL("../../.bun-version", import.meta.url)).text()).trim();
  expect(Bun.semver.satisfies(version, ">=1.4.4")).toBe(true);
  const docker = await Bun.file(new URL("../../Dockerfile", import.meta.url)).text();
  const stages = [...docker.matchAll(/^FROM oven\/bun:([^\s]+) /gm)].map((match) => match[1]);
  expect(stages).toHaveLength(2);
  expect(stages.every((stage) => stage === version)).toBe(true);
});
