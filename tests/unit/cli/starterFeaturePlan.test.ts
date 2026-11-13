import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
    expect(existsSync(join(options.targetDir, "strata.features.json"))).toBe(true);
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
    "renders required artifacts and records complete emitted inventory for %s",
    (profile) => {
      const options = fixture();
      options.layers = exampleAppLayers(profile);
      generateProject(options);
      const manifest = JSON.parse(
        readFileSync(join(options.targetDir, "strata.features.json"), "utf8"),
      );
      for (const artifact of manifest.artifacts)
        expect(existsSync(join(options.targetDir, artifact))).toBe(true);
      const actual = (directory: string, prefix = ""): string[] =>
        readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
          const path = `${prefix}${entry.name}`;
          return entry.isDirectory() ? actual(join(directory, entry.name), `${path}/`) : [path];
        });
      expect(manifest.emittedArtifacts).toEqual(actual(options.targetDir).sort());
      expect(manifest.decisions.users).toBe(profile !== "hiroapp-hobby");
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
    (auth) => {
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
      expect(renderAuthProvider(plan)).toContain(
        'requireConfiguredSecret(["SIGNED_URL_SECRET","SESSION_SECRET","OAUTH_STATE_SECRET"]',
      );
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
