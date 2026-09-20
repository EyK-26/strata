/**
 * HTTP smoke for create-strata integration extras (OAuth GitHub, billing, webhooks).
 * Runs in CI after HiroApp smoke — isolated subprocess, not part of bun test coverage.
 */
import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../packages/strata-starter/src/parseArgs.ts";

const repoRoot = join(import.meta.dir, "..");

function stripeSignature(rawBody: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "strata-integrations-http-"));
  try {
    const flags = parseCreateStrataArgs([
      "integrations-smoke",
      "--frontend=server-htmx",
      "--database=sqlite",
      "--auth=cookie",
      "--oauth-github",
      "--billing",
      "--webhooks",
      "--yes",
    ]);
    const app = join(root, "integrations-smoke");
    generateProject({
      projectName: "integrations-smoke",
      targetDir: app,
      layers: layersFromFlags(flags),
      templateRoot: resolveTemplateRoot(),
      overlayRoot: resolveOverlayRoot(),
    });

    const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    pkg.dependencies["@getstrata/core"] = `file:${join(repoRoot, "packages/strata-core")}`;
    pkg.dependencies["@getstrata/bootstrap"] =
      `file:${join(repoRoot, "packages/strata-bootstrap")}`;
    pkg.dependencies["@getstrata/cli"] = `file:${join(repoRoot, "packages/strata-cli")}`;
    await writeFile(join(app, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

    const install = Bun.spawnSync({
      cmd: ["bun", "install"],
      cwd: app,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (install.exitCode !== 0) {
      throw new Error(`bun install failed in generated app:\n${install.stderr.toString()}`);
    }

    await mkdir(join(app, "storage"), { recursive: true });
    process.env.DATABASE_URL = `sqlite:${join(app, "storage/app.sqlite")}`;
    process.env.APP_ENV = "local";
    process.env.FRONTEND_MODE = "server-htmx";
    process.env.TENANCY_DRIVER = "none";
    process.env.SESSION_SECRET = "dev-session-secret-change-me-please-32ch";
    process.env.MAIL_DRIVER = "log";
    process.env.CACHE_DRIVER = "array";
    process.env.QUEUE_DRIVER = "sync";
    process.env.FEATURE_OAUTH = "true";
    process.env.GITHUB_CLIENT_ID = "test-client-id";
    process.env.GITHUB_CLIENT_SECRET = "test-client-secret";
    process.env.FEATURE_BILLING = "true";
    const stripeWebhookSecret = "whsec_integration_smoke";
    process.env.STRIPE_WEBHOOK_SECRET = stripeWebhookSecret;

    const { bootstrapApp, createAppServer } = await import(
      `${join(app, "src/bootstrap/createApp.ts")}`
    );
    const { closeDatabase } = await import(`${join(app, "src/bootstrap/database.ts")}`);
    const { routes } = await bootstrapApp();
    const server = createAppServer(routes, 0);
    const origin = `http://127.0.0.1:${server.port}`;

    try {
      const login = await fetch(`${origin}/login`);
      assert(login.status === 200, `login status ${login.status}`);
      assert((await login.text()).includes("/auth/github"), "login missing GitHub link");

      const github = await fetch(`${origin}/auth/github`, { redirect: "manual" });
      assert(github.status === 302, `github redirect status ${github.status}`);
      assert(
        (github.headers.get("location") ?? "").includes("github.com/login/oauth/authorize"),
        "github location missing authorize URL",
      );

      const rawBody = JSON.stringify({ id: "evt_smoke", type: "customer.subscription.updated" });
      const stripe = await fetch(`${origin}/billing/webhooks/stripe`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": stripeSignature(rawBody, stripeWebhookSecret),
        },
        body: rawBody,
      });
      assert(stripe.status === 200, `stripe webhook status ${stripe.status}`);
      const stripeJson = (await stripe.json()) as { received?: boolean };
      assert(stripeJson.received === true, "stripe webhook body missing received:true");
    } finally {
      server.stop();
      await closeDatabase();
    }

    console.log("Integration extras smoke passed (GitHub redirect + Stripe webhook).");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
