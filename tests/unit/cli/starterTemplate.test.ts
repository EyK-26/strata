import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { compileStarterFeatures } from "../../../packages/strata-starter/src/featurePlan.ts";
import { renderPackageJson } from "../../../packages/strata-starter/src/renderProjectMetadata";
import { createConfigProvider } from "../../../src/bootstrap/application/services";
import { CSRF_TARGET_ORIGIN_CONFIG_KEY } from "../../../src/bootstrap/config";
import { ConfigStore, ServiceContainer } from "../../../src/core/contracts/container";
import type { ServiceProvider } from "../../../src/core/contracts/di";

describe("starter template CLI", () => {
  test("depends on @getstrata/cli and uses strata scripts", async () => {
    const packageJson = JSON.parse(renderPackageJson("template-contract")) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };

    expect(packageJson.dependencies["@getstrata/cli"]).toBe("^3.0.6");
    expect(packageJson.dependencies["@getstrata/core"]).toBe("^3.0.6");
    expect(packageJson.dependencies["@getstrata/bootstrap"]).toBe("^3.0.6");
    expect(packageJson.dependencies.eta).toBe("^4.6.0");
    expect(packageJson.dependencies.mysql2).toBeUndefined();
    expect(packageJson.scripts.dev).toBe("strata dev");
    expect(packageJson.scripts.start).toBe("strata start");
    expect(packageJson.scripts["db:migrate"]).toBe("strata migrate");
    expect(packageJson.scripts["db:fresh"]).toBe("strata migrate:fresh");
    expect(packageJson.scripts["queue:work"]).toBe("strata queue:work");
  });

  test("create-strata next steps use bun run scripts, not a global strata", async () => {
    const source = await readFile(
      join(process.cwd(), "packages/strata-starter/src/generate.ts"),
      "utf8",
    );
    // `strata` lands in the app's node_modules/.bin, not on PATH, so the
    // printed steps have to go through the package.json scripts.
    expect(source).toContain("bun run db:migrate");
    expect(source).toContain("bun run dev");
    expect(source).not.toContain('console.log("  strata migrate")');
    expect(source).not.toContain('console.log("  strata dev\\n")');
  });
});

test("generated CORS examples remain explicit opt-ins and preserve safe defaults", async () => {
  const { renderEnvExample } = await import("../../../packages/strata-starter/src/renderEnv.ts");
  const { layersFromFlags, parseCreateStrataArgs } = await import(
    "../../../packages/strata-starter/src/parseArgs.ts"
  );
  const env = renderEnvExample(
    "cors-app",
    compileStarterFeatures(layersFromFlags(parseCreateStrataArgs(["cors-app"]))),
  );
  expect(env).toContain("# CORS_ALLOWED_ORIGINS=https://app.example.com");
  expect(env).toContain("# CORS_ADDITIONAL_ALLOWED_HEADERS=Idempotency-Key,X-Correlation-Id");
  expect(env.split("\n").some((line) => line.startsWith("CORS_ADDITIONAL_ALLOWED_HEADERS="))).toBe(
    false,
  );
  expect(env.split("\n").some((line) => line.startsWith("CORS_ALLOWED_ORIGINS="))).toBe(false);
});

test("generated CSRF target example is opt-in and config providers wire its explicit value", async () => {
  const { renderEnvExample } = await import("../../../packages/strata-starter/src/renderEnv.ts");
  const { layersFromFlags, parseCreateStrataArgs } = await import(
    "../../../packages/strata-starter/src/parseArgs.ts"
  );
  const layers = layersFromFlags(parseCreateStrataArgs(["csrf-app"]));
  const env = renderEnvExample("csrf-app", compileStarterFeatures(layers));
  expect(env).toContain("# CSRF_TARGET_ORIGIN=https://app.example.com");
  expect(env.split("\n").some((line) => line.startsWith("CSRF_TARGET_ORIGIN="))).toBe(false);
  const values = await registerConfig(
    createConfigProvider(appConfig, { CSRF_TARGET_ORIGIN: "https://app.example.com" }),
  );
  expect(values.get(CSRF_TARGET_ORIGIN_CONFIG_KEY)).toBe("https://app.example.com");
  const unset = await registerConfig(createConfigProvider(appConfig, {}));
  expect(unset.has(CSRF_TARGET_ORIGIN_CONFIG_KEY)).toBe(false);
});

const appConfig = { appUrl: "https://owner.test", databaseUrl: "sqlite::memory:", port: 3000 };
async function registerConfig(provider: ServiceProvider): Promise<ConfigStore> {
  const config = new ConfigStore(),
    container = new ServiceContainer();
  const invoke = async () => {
    throw new Error("Config registration must not invoke persistence.");
  };
  await provider.register?.({
    config,
    container,
    invoke,
    dependencies: { container, invoke },
    onCleanup: () => {},
  });
  return config;
}

test("config providers capture each owner's debug setting before registration", async () => {
  const firstEnv = { APP_DEBUG: "true" },
    secondEnv = { APP_DEBUG: "false" };
  const first = createConfigProvider(appConfig, firstEnv),
    second = createConfigProvider(appConfig, secondEnv);
  firstEnv.APP_DEBUG = "false";
  secondEnv.APP_DEBUG = "true";
  expect((await registerConfig(first)).get("app.debug")).toBe(true);
  expect((await registerConfig(second)).get("app.debug")).toBe(false);
});
