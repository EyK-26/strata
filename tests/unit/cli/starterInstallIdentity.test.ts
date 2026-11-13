import { expect, test } from "bun:test";
import { starterInstallIdentity } from "../../helpers/starterInstallIdentity";

test("profile dependency sharing rejects changed archive, optional peers, hooks and overrides", () => {
  const base = {
    name: "one",
    dependencies: { "@getstrata/core": "file:/owned/core.tgz" },
    devDependencies: { typescript: "7.0.2" },
    scripts: { check: "tsc --noEmit" },
    overrides: { "bun-types": ">=1.4.4" },
  };
  const same = {
    scripts: base.scripts,
    overrides: base.overrides,
    devDependencies: base.devDependencies,
    dependencies: base.dependencies,
    name: "two",
  };
  expect(starterInstallIdentity(base)).toBe(starterInstallIdentity(same));
  for (const change of [
    { dependencies: { "@getstrata/core": "file:/other/core.tgz" } },
    { optionalDependencies: { "optional-adapter": "1.0.0" } },
    { peerDependencies: { "optional-adapter": "2.0.0" } },
    { scripts: { ...base.scripts, postinstall: "bun setup.ts" } },
    { overrides: { "bun-types": "1.4.5" } },
    { trustedDependencies: ["native-adapter"] },
  ])
    expect(starterInstallIdentity({ ...base, ...change })).not.toBe(starterInstallIdentity(base));
});
