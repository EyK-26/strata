import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileStarterFeatures } from "../../../packages/strata-starter/src/featurePlan.ts";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../../packages/strata-starter/src/generate.ts";
import { defaultLayers, exampleAppLayers } from "../../../packages/strata-starter/src/presets.ts";
import {
  renderAuthModule,
  renderAuthProvider,
} from "../../../packages/strata-starter/src/renderAuth.ts";
import { renderCreateAppTs } from "../../../packages/strata-starter/src/renderBootstrap.ts";
import {
  renderEnvExample,
  renderPackageJson,
} from "../../../packages/strata-starter/src/renderEnv.ts";
import { renderStarterSchemaMigration } from "../../../packages/strata-starter/src/renderMigrations.ts";
import { renderModelsRegister } from "../../../packages/strata-starter/src/renderModels.ts";

const owned: string[] = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "strata-feature-plan-"));
  owned.push(directory);
  return {
    projectName: "app",
    targetDir: join(directory, "app"),
    layers: defaultLayers(),
    templateRoot: resolveTemplateRoot(),
    overlayRoot: resolveOverlayRoot(),
  };
}
afterEach(() => {
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("starter feature compilation", () => {
  test("freezes an independent snapshot and derives capabilities and requirements", () => {
    const input = exampleAppLayers("hiroapp");
    const plan = compileStarterFeatures(input);
    expect(plan.decisions).toMatchObject({
      users: true,
      cookie: true,
      tenantTable: true,
      pendingMfa: true,
    });
    expect(plan.requirements).toContainEqual({ feature: "mfa", capability: "auth:cookie" });
    expect(plan.conflicts).toEqual([]);
    expect(plan.artifacts).toContain("src/bootstrap/pendingMfa.ts");
    input.extras.mfa = false;
    input.docker.services.postgres = false;
    expect(plan.layers.extras.mfa).toBe(true);
    expect(Object.isFrozen(plan.layers.docker.services)).toBe(true);
    expect(Object.isFrozen(plan.requirements[0])).toBe(true);
    expect(Object.isFrozen(plan.artifacts)).toBe(true);
    const unknown = { ...defaultLayers(), unvalidated: { mutable: true } };
    expect("unvalidated" in compileStarterFeatures(unknown).layers).toBe(false);
  });

  test.each([
    { tenancy: "rls", database: "sqlite" },
    { auth: "invalid" },
    { spaPrefix: "/api" },
    { extras: { ...defaultLayers().extras, mfa: true } },
  ])("rejects invalid inputs before acquiring output: %j", (invalid) => {
    const options = fixture();
    Object.assign(options.layers, invalid);
    expect(() => generateProject(options)).toThrow();
    expect(existsSync(options.targetDir)).toBe(false);
  });

  test("rejects malformed booleans at the programmatic boundary", () => {
    const layers = defaultLayers();
    Object.assign(layers.docker.services, { redis: "false" });
    expect(() => compileStarterFeatures(layers)).toThrow("Invalid Docker service redis");
  });

  test("supports new parent directories while exclusively acquiring the target", () => {
    const options = fixture();
    options.targetDir = join(options.targetDir, "nested", "app");
    generateProject(options);
    expect(existsSync(join(options.targetDir, "strata.layers.json"))).toBe(true);
    expect(() => generateProject(options)).toThrow("Output path already exists");
  });

  test("preserves existing output even with force", () => {
    const options = fixture();
    mkdirSync(options.targetDir);
    writeFileSync(join(options.targetDir, "sentinel"), "user data");
    expect(() => generateProject({ ...options, force: true })).toThrow(
      "--force does not overwrite",
    );
    expect(readFileSync(join(options.targetDir, "sentinel"), "utf8")).toBe("user data");
  });

  test("refuses dangling output symlinks", () => {
    const options = fixture();
    symlinkSync(join(options.targetDir, "missing"), options.targetDir);
    expect(() => generateProject({ ...options, force: true })).toThrow(
      "Output path already exists",
    );
    expect(lstatSync(options.targetDir).isSymbolicLink()).toBe(true);
  });

  test("removes partially copied output after renderer failure and permits a retry", () => {
    const options = fixture();
    const brokenTemplate = join(options.targetDir, "..", "broken-template");
    mkdirSync(brokenTemplate);
    writeFileSync(join(brokenTemplate, "partial.txt"), "partially copied");
    options.layers.frontend = "spa-react";
    expect(() =>
      generateProject({ ...options, templateRoot: brokenTemplate, overlayRoot: brokenTemplate }),
    ).toThrow();
    expect(existsSync(options.targetDir)).toBe(false);
    generateProject(options);
    expect(existsSync(join(options.targetDir, "frontend/src/auth/config.ts"))).toBe(true);
    const frontendConfig = readFileSync(join(options.targetDir, "frontend/src/config.ts"), "utf8");
    expect(frontendConfig).toContain(
      'import { validateSpaPrefix } from "@getstrata/core/runtime/frontendMode";',
    );
    expect(frontendConfig).not.toContain("featurePlan.ts");
  });

  test.each(["hiroapp-hobby", "hiroapp-team", "hiroapp"] as const)(
    "renders compiled artifacts and records selected layers for %s",
    (profile) => {
      const options = fixture();
      options.layers = exampleAppLayers(profile);
      generateProject(options);
      const plan = compileStarterFeatures(options.layers);
      for (const artifact of plan.artifacts)
        expect(existsSync(join(options.targetDir, artifact))).toBe(true);
      const recorded = JSON.parse(
        readFileSync(join(options.targetDir, "strata.layers.json"), "utf8"),
      );
      expect(recorded.layers).toEqual(plan.layers);
      expect(plan.decisions.users).toBe(profile !== "hiroapp-hobby");
    },
  );
});

describe("compiled decision consumption", () => {
  test.each(["api", "server-htmx", "spa-react", "hybrid"] as const)(
    "%s consumers use the same immutable capability snapshot",
    (frontend) => {
      const options = fixture();
      options.layers = { ...exampleAppLayers("hiroapp-team"), frontend };
      options.layers.extras.mfa = true;
      const plan = compileStarterFeatures(options.layers);
      // Mutating the caller's selections cannot change any renderer's decisions.
      options.layers.auth = "headers";
      options.layers.extras.mfa = false;
      const models = renderModelsRegister(plan);
      const migration = renderStarterSchemaMigration(plan);
      const auth = renderAuthModule(plan);
      if (!auth) throw new Error("Compiled account capability did not render auth routes.");
      const provider = renderAuthProvider(plan);
      const env = renderEnvExample("app", plan);
      const manifest = JSON.parse(renderPackageJson("app", { plan }));
      expect(models).toContain("UserRepository");
      expect(migration).toContain("CREATE TABLE IF NOT EXISTS users");
      expect(provider).toContain(JSON.stringify(plan.decisions.authMechanisms));
      expect(auth.includes('"/api/v1/auth/register"')).toBe(plan.decisions.jsonAccounts);
      expect(auth.includes('"/login"')).toBe(plan.decisions.cookie);
      expect(env.includes("\nSESSION_SECRET=")).toBe(plan.decisions.sessionSecret);
      expect(Boolean(manifest.scripts["frontend:build"])).toBe(plan.decisions.frontendBuild);
      expect(plan.decisions.pendingMfa).toBe(true);
      expect(plan.decisions.mfaViews).toBe(frontend === "api" || frontend === "spa-react");
    },
  );

  test.each(["token", "jwt"] as const)(
    "%s API account flows receive a dedicated signed URL secret",
    async (auth) => {
      const layers = { ...defaultLayers(), frontend: "api" as const, auth };
      layers.extras.emailVerification = true;
      layers.extras.scim = true;
      const plan = compileStarterFeatures(layers);
      const env = renderEnvExample("app", plan);
      expect(plan.requirements).toContainEqual({
        feature: "auth:accounts",
        capability: "config:signed-urls",
      });
      expect(plan.decisions.dedicatedSigningSecret).toBe(true);
      expect(env).toContain("SIGNED_URL_SECRET=dev-signed-url-secret-change-me-please-32ch");
      expect(env).not.toContain("\nSESSION_SECRET=");
      expect(renderAuthProvider(plan)).toContain("createAuthRuntimeConfig(options,");
      const { createAuthRuntimeConfig } = await import("../../../src/bootstrap/auth/runtimeConfig");
      const features = {
        users: true,
        cookie: false,
        token: auth === "token",
        jwt: auth === "jwt",
        signedUrls: true,
      };
      const options = {
        environment: { APP_ENV: "production", API_TOKEN_DEFAULT_EXPIRY_DAYS: "30" },
        production: true,
        jwtSecret: "production-jwt-secret",
      };
      expect(() => createAuthRuntimeConfig(options, features)).toThrow("SIGNED_URL_SECRET");
      const configured = createAuthRuntimeConfig(
        { ...options, signatureSecret: "configured-dedicated-signing-secret" },
        features,
      );
      expect(configured.signatureSecret).toBe("configured-dedicated-signing-secret");
    },
  );

  test("header-only API omits account, session, bearer and frontend capabilities", () => {
    const plan = compileStarterFeatures(defaultLayers());
    expect(plan.decisions).toMatchObject({
      users: false,
      cookie: false,
      token: false,
      jwt: false,
      signedUrls: false,
      dedicatedSigningSecret: false,
      frontendBuild: false,
    });
    expect(renderAuthModule(plan)).toBeNull();
    expect(renderModelsRegister(plan)).not.toContain("UserRepository");
    expect(renderStarterSchemaMigration(plan)).not.toContain("CREATE TABLE IF NOT EXISTS users");
    expect(renderEnvExample("app", plan)).not.toContain("\nSIGNED_URL_SECRET=");
    expect(
      JSON.parse(renderPackageJson("app", { plan })).scripts["frontend:build"],
    ).toBeUndefined();
  });

  test.each(["mfa", "oauthGithub", "oidc", "emailVerification", "scim"] as const)(
    "rejects unsupported %s before creating even the output parent",
    (extra) => {
      const options = fixture();
      options.targetDir = join(options.targetDir, "missing", "app");
      options.layers.extras[extra] = true;
      expect(() => generateProject(options)).toThrow("unsupported with headers");
      expect(existsSync(join(options.targetDir, ".."))).toBe(false);
    },
  );
});

test.each([false, true])(
  "packaged route assembly includes enabled module builders (views=%s)",
  async (views) => {
    const options = fixture();
    options.layers.frontend = views ? "server-htmx" : "api";
    generateProject(options);
    const moduleDirectory = join(options.targetDir, "src/modules/owned");
    mkdirSync(moduleDirectory, { recursive: true });
    writeFileSync(
      join(moduleDirectory, "index.ts"),
      `export const seen:string[]=[];
export default {name:"owned",routes(){seen.push("api");return {"/api/owned":{GET:()=>new Response("api")}};},webRoutes(){seen.push("web");return {"/owned":{GET:()=>new Response("web")}};}};`,
    );
    const repository = join(import.meta.dir, "../../..");
    const config = JSON.parse(readFileSync(join(repository, "tsconfig.json"), "utf8"));
    for (const [alias, paths] of Object.entries(config.compilerOptions.paths))
      config.compilerOptions.paths[alias] = (paths as string[]).map((path) =>
        join(repository, path),
      );
    config.compilerOptions.paths["@getstrata/core/database/migrations"] = [
      join(repository, "src/core/database/migrations/runner.ts"),
    ];
    writeFileSync(join(options.targetDir, "source-tsconfig.json"), JSON.stringify(config));
    writeFileSync(
      join(options.targetDir, "probe.ts"),
      `import {strict as assert} from "node:assert";
import {createApp} from "./src/bootstrap/createApp.ts";
import {seen} from "./src/modules/owned/index.ts";
const app=await createApp({migrate:false});
try { assert.ok(app.routes["/api/owned"]);assert.equal(Boolean(app.routes["/owned"]),${views});assert.deepEqual([...seen].sort(),${JSON.stringify(views ? ["api", "web"] : ["api"])}); }
finally {await app.context.dispose();}
console.log("owned-route-assembly-pass");`,
    );
    const child = Bun.spawn(
      [
        process.execPath,
        "--tsconfig-override",
        join(options.targetDir, "source-tsconfig.json"),
        "probe.ts",
      ],
      {
        cwd: options.targetDir,
        env: {
          ...process.env,
          APP_ENV: "local",
          FRONTEND_MODE: views ? "server-htmx" : "api",
          DATABASE_URL: "sqlite::memory:",
          APP_DATABASE_URL: "sqlite::memory:",
          CACHE_DRIVER: "array",
          QUEUE_DRIVER: "sync",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
    expect(stdout).toContain("owned-route-assembly-pass");
    expect(renderCreateAppTs(compileStarterFeatures(options.layers))).toContain("defineApp({");
  },
);
