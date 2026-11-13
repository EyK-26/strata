import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { compileStarterFeatures } from "../../../packages/strata-starter/src/featurePlan.ts";

describe("starter template CLI", () => {
  test("depends on @getstrata/cli and uses strata scripts", async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "packages/strata-starter/templates/package.json"), "utf8"),
    ) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };

    expect(packageJson.dependencies["@getstrata/cli"]).toBe("^3.0.0");
    expect(packageJson.dependencies["@getstrata/core"]).toBe("^3.0.0");
    expect(packageJson.dependencies["@getstrata/bootstrap"]).toBe("^3.0.0");
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
  const { renderConfigProvider } = await import(
    "../../../packages/strata-starter/src/renderBootstrap.ts"
  );
  const { layersFromFlags, parseCreateStrataArgs } = await import(
    "../../../packages/strata-starter/src/parseArgs.ts"
  );
  const layers = layersFromFlags(parseCreateStrataArgs(["csrf-app"]));
  const env = renderEnvExample("csrf-app", compileStarterFeatures(layers));
  expect(env).toContain("# CSRF_TARGET_ORIGIN=https://app.example.com");
  expect(env.split("\n").some((line) => line.startsWith("CSRF_TARGET_ORIGIN="))).toBe(false);
  expect(renderConfigProvider(compileStarterFeatures(layers))).toContain(
    "config.set(CSRF_TARGET_ORIGIN_CONFIG_KEY, env.CSRF_TARGET_ORIGIN)",
  );
});

test("generated config providers capture each owner's debug setting before registration", async () => {
  const { renderConfigProvider } = await import(
    "../../../packages/strata-starter/src/renderBootstrap.ts"
  );
  const { layersFromFlags, parseCreateStrataArgs } = await import(
    "../../../packages/strata-starter/src/parseArgs.ts"
  );
  const layers = layersFromFlags(parseCreateStrataArgs(["debug-owner"]));
  const rendered = renderConfigProvider(compileStarterFeatures(layers));
  const executable = new Bun.Transpiler({ loader: "ts" })
    .transformSync(rendered.replace(/^import[\s\S]*?;\n/gm, ""))
    .replace("export function", "function");
  const create = new Function(
    "CORE_CONFIG_TOKEN",
    "CORE_PUBLIC_TENANCY_TOKEN",
    "CSRF_TARGET_ORIGIN_CONFIG_KEY",
    "DATABASE_URL_CONFIG_KEY",
    "APP_PORT_CONFIG_KEY",
    "REDIS_URL_CONFIG_KEY",
    "isProductionEnv",
    "normalizeTenantHostname",
    `${executable}; return createConfigProvider;`,
  )(
    "config",
    "tenant",
    "csrf",
    "db",
    "port",
    "redis",
    () => false,
    (value: string) => value,
  );
  const firstEnv = { APP_DEBUG: "true" };
  const secondEnv = { APP_DEBUG: "false" };
  const appConfig = { appUrl: "https://owner.test", databaseUrl: "sqlite::memory:", port: 3000 };
  const first = create(appConfig, firstEnv);
  const second = create(appConfig, secondEnv);
  firstEnv.APP_DEBUG = "false";
  secondEnv.APP_DEBUG = "true";
  const register = (provider: typeof first) => {
    const values = new Map<string, unknown>();
    provider.register({
      container: { set: () => {} },
      config: { set: (key: string, value: unknown) => values.set(key, value) },
    });
    return values;
  };
  expect(register(first).get("app.debug")).toBe(true);
  expect(register(second).get("app.debug")).toBe(false);
});
