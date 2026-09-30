import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
  usage,
} from "../../../packages/strata-starter/src/parseArgs.ts";

const tempDirectories: string[] = [];

afterEach(async () => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "strata-integrations-"));
  tempDirectories.push(directory);
  return directory;
}

function generateFromArgs(directory: string, argv: string[]): string {
  const flags = parseCreateStrataArgs(argv);
  const name = flags.projectName ?? "app";
  generateProject({
    projectName: name,
    targetDir: join(directory, name),
    layers: layersFromFlags(flags),
    templateRoot: resolveTemplateRoot(),
    overlayRoot: resolveOverlayRoot(),
  });
  return join(directory, name);
}

describe("create-strata integration extras", () => {
  test("usage lists oauth, billing, and webhook flags", () => {
    const text = usage();
    expect(text).toContain("--oauth-github");
    expect(text).toContain("--oidc");
    expect(text).toContain("--billing");
    expect(text).toContain("--webhooks");
  });

  test("header auth keeps billing and webhooks and drops GitHub OAuth", () => {
    const layers = layersFromFlags(
      parseCreateStrataArgs([
        "app",
        "--auth=headers",
        "--oauth-github",
        "--billing",
        "--webhooks",
        "--yes",
      ]),
    );
    expect(layers.extras.oauthGithub).toBe(false);
    expect(layers.extras.billing).toBe(true);
    expect(layers.extras.webhooks).toBe(true);
  });

  test("--oauth-github writes GitHub cookie routes and a login link", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "gh-app",
      "--frontend=server-htmx",
      "--auth=cookie",
      "--oauth-github",
      "--yes",
    ]);
    const env = await readFile(join(app, ".env.example"), "utf8");
    expect(env).toContain("FEATURE_OAUTH=true");
    expect(env).toContain("GITHUB_REDIRECT_URI=http://localhost:3000/auth/github/callback");
    expect(env).toMatch(/^OAUTH_STATE_SECRET=.*change-me/m);
    const auth = await readFile(join(app, "src/modules/auth/index.ts"), "utf8");
    expect(auth).toContain('"/auth/github"');
    expect(auth).toContain('"/auth/github/callback"');
    expect(auth).toContain("GitHubOAuthProvider");
    expect(auth).toContain("completeBrowserSsoLogin");
    const login = await readFile(join(app, "views/auth/login.eta"), "utf8");
    expect(login).toContain("/auth/github");
  });

  test("--oidc writes PKCE cookie routes and does not call getAuthorizationUrl", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "oidc-app",
      "--frontend=server-htmx",
      "--auth=cookie",
      "--oidc",
      "--yes",
    ]);
    const env = await readFile(join(app, ".env.example"), "utf8");
    expect(env).toContain("FEATURE_OAUTH=true");
    expect(env).toContain("OIDC_ISSUER=http://127.0.0.1:8080");
    expect(env).toContain("OIDC_REDIRECT_URI=http://localhost:3000/auth/oidc/callback");
    expect(env).toContain("# OIDC_ALLOW_PRIVATE=true");
    const auth = await readFile(join(app, "src/modules/auth/index.ts"), "utf8");
    expect(auth).toContain('"/auth/oidc"');
    expect(auth).toContain('"/auth/oidc/callback"');
    expect(auth).toContain("createAuthorization");
    expect(auth).toContain("sealOidcPkceCookie");
    expect(auth).toContain("readOidcPkceCookie");
    expect(auth).not.toContain("getAuthorizationUrl");
    const login = await readFile(join(app, "views/auth/login.eta"), "utf8");
    expect(login).toContain("it.oidcLogin");
    expect(login).toContain('href="/auth/oidc"');
    const view = await readFile(join(app, "src/lib/view.ts"), "utf8");
    expect(view).toContain("OIDC_CLIENT_ID");
    expect(auth).toContain("profile.email.trim().toLowerCase()");
  });

  test("header auth drops --oidc", () => {
    const layers = layersFromFlags(
      parseCreateStrataArgs(["app", "--auth=headers", "--oidc", "--yes"]),
    );
    expect(layers.extras.oidc).toBe(false);
  });

  test("--billing writes the Stripe stub module and migration", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "bill-app",
      "--auth=headers",
      "--tenancy=column",
      "--billing",
      "--yes",
    ]);
    expect(existsSync(join(app, "src/modules/billing/index.ts"))).toBe(true);
    expect(existsSync(join(app, "src/db/migrations/0002_billing_schema.ts"))).toBe(true);
    const billing = await readFile(join(app, "src/modules/billing/index.ts"), "utf8");
    expect(billing).toContain("/billing/webhooks/stripe");
    expect(billing).toContain("/api/v1/billing/subscription");
    expect(billing).toContain("verifyStripeWebhookSignature");
    expect(billing).toContain("applyStripeWebhook");
    expect(billing).not.toContain("runWithMigrationBypass(");
    const hook = await readFile(join(app, "src/billing/applyStripeWebhook.ts"), "utf8");
    expect(hook).toContain("async function applyStripeWebhook");
    expect(hook).not.toContain("tenant.plan");
    const migration = await readFile(join(app, "src/db/migrations/0002_billing_schema.ts"), "utf8");
    expect(migration).toContain("stripe_webhook_event");
    expect(migration).toContain("stripe_customer_id");
    const env = await readFile(join(app, ".env.example"), "utf8");
    expect(env).toContain("FEATURE_BILLING=true");
    expect(env).toMatch(/^STRIPE_WEBHOOK_SECRET=.*change-me/m);
    const api = await readFile(join(app, "docs/API.md"), "utf8");
    expect(api).toContain("/billing/webhooks/stripe");
    const queue = await readFile(join(app, "src/bootstrap/providers/queue.ts"), "utf8");
    expect(queue).toContain("discoverJobs()");
  });

  test("--webhooks writes webhook.dispatch and a notes.created listener", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["hook-app", "--webhooks", "--yes"]);
    const job = await readFile(join(app, "src/jobs/dispatchOutboundWebhookJob.ts"), "utf8");
    expect(job).toContain('static readonly jobName = "webhook.dispatch"');
    expect(job).toContain("signWebhookBody");
    expect(job).toContain("WEBHOOK_ALLOW_PRIVATE");
    expect(job).toContain("VALUES (?, ?, ?, ?, ?, ?)");
    expect(job).toContain("payload.event");
    expect(job).toContain("runWithMigrationBypass(async () => {");
    expect(job).not.toContain('"notes.created"');
    const listener = await readFile(
      join(app, "src/listeners/noteCreatedWebhookListener.ts"),
      "utf8",
    );
    expect(listener).toContain('modelEventName("notes", "created")');
    expect(listener).toContain("event,");
    expect(existsSync(join(app, "src/db/migrations/0002_webhooks_schema.ts"))).toBe(true);
    const providers = await readFile(join(app, "src/bootstrap/providers/index.ts"), "utf8");
    expect(providers).toContain("discoverListeners");
  });

  test("postgres webhooks and billing use $1 placeholders", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, [
      "pg-app",
      "--database=postgres",
      "--tenancy=column",
      "--webhooks",
      "--billing",
      "--yes",
    ]);
    const job = await readFile(join(app, "src/jobs/dispatchOutboundWebhookJob.ts"), "utf8");
    expect(job).toContain("VALUES ($1, $2, $3, $4, $5, $6)");
    expect(job).not.toContain("VALUES (?, ?, ?, ?, ?, ?)");
    const billing = await readFile(join(app, "src/modules/billing/index.ts"), "utf8");
    expect(billing).toContain("tenant_id = $1");
    const readme = await readFile(join(app, "README.md"), "utf8");
    expect(readme).toContain("HTML admin and storefront paths are not");
  });

  test("billing after webhooks uses 0003 for the billing migration", async () => {
    const root = await tempDir();
    const app = generateFromArgs(root, ["both-app", "--webhooks", "--billing", "--yes"]);
    expect(existsSync(join(app, "src/db/migrations/0002_webhooks_schema.ts"))).toBe(true);
    expect(existsSync(join(app, "src/db/migrations/0003_billing_schema.ts"))).toBe(true);
  });
});
