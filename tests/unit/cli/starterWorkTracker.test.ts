import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileStarterFeatures } from "../../../packages/strata-starter/src/featurePlan.ts";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs.ts";
import { defaultLayers } from "../../../packages/strata-starter/src/presets.ts";

const owned: string[] = [];
afterEach(() => {
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true });
});
test("reference requirements fail before output is acquired", () => {
  const root = mkdtempSync(join(tmpdir(), "strata-work-contract-"));
  owned.push(root);
  const targetDir = join(root, "app");
  expect(() =>
    generateProject({
      projectName: "app",
      targetDir,
      layers: defaultLayers(),
      reference: "work-tracker",
      templateRoot: resolveTemplateRoot(),
      overlayRoot: resolveOverlayRoot(),
    }),
  ).toThrow("Work tracker requires user authentication and tenant isolation");
  expect(existsSync(targetDir)).toBe(false);
});
for (const [frontend, auth] of [
  ["server-htmx", "cookie"],
  ["api", "token"],
] as const)
  test(`reference ${frontend}/${auth} emits one shared domain and complete wiring`, () => {
    const root = mkdtempSync(join(tmpdir(), "strata-work-contract-"));
    owned.push(root);
    const targetDir = join(root, "app");
    const layers = layersFromFlags(
      parseCreateStrataArgs([
        "app",
        "--yes",
        `--frontend=${frontend}`,
        `--auth=${auth}`,
        "--tenancy=column",
      ]),
    );
    const plan = compileStarterFeatures(layers, "work-tracker");
    expect(plan.requirements).toContainEqual({
      feature: "reference:work-tracker",
      capability: "auth:users",
    });
    expect(plan.requirements).toContainEqual({
      feature: "reference:work-tracker",
      capability: "tenancy:enabled",
    });
    generateProject({
      projectName: "app",
      targetDir,
      layers,
      reference: "work-tracker",
      templateRoot: resolveTemplateRoot(),
      overlayRoot: resolveOverlayRoot(),
    });
    for (const artifact of plan.artifacts) expect(existsSync(join(targetDir, artifact))).toBe(true);
    for (const artifact of plan.artifacts.filter((path) => path.endsWith(".ts")))
      expect(() =>
        new Bun.Transpiler({ loader: "ts" }).transformSync(
          readFileSync(join(targetDir, artifact), "utf8"),
        ),
      ).not.toThrow();
    const read = (path: string) => readFileSync(join(targetDir, path), "utf8");
    expect(read("src/bootstrap/createApp.ts")).toContain(
      "container.set(WORK_TRACKER_OUTBOX,publisher!)",
    );
    expect(read("src/models/register.ts")).toContain("...workTrackerRepositories");
    expect(read("src/outbox/registry.ts")).toContain("[workTrackerListener]");
    expect(read("src/domain/workTracker.ts")).toContain(
      'await gate(tx).authorize("work","mutateTask",principal,organizationId)',
    );
    expect(read("src/domain/workTracker.ts")).toContain('publisher.publish(tx,"work.changed"');
    expect(read("src/modules/workTracker/index.ts")).toContain("ports.established.tenant.id");
    expect(read("src/modules/workTracker/index.ts")).toContain("currentRequestMeta().csrfToken");
  });
