/**
 * HTTP smoke for create-strata integration extras (OAuth GitHub, billing, webhooks).
 * Runs after generated CLI HTTP smoke — isolated subprocess, not part of bun test coverage.
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

type ApplicationOwner = import("@getstrata/core/contracts/application").Application;
type ChildOwner = Pick<ReturnType<typeof Bun.spawn>, "exited" | "kill">;

async function runChild(cmd: string[], cwd: string, children: Set<ChildOwner>): Promise<void> {
  const child = Bun.spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe", timeout: 120_000 });
  children.add(child);
  // Observe exit and both output streams together so output cannot block termination.
  const results = await Promise.allSettled([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const exit = results[0];
  if (exit.status === "fulfilled") children.delete(child);
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (exit.status === "fulfilled" && exit.value !== 0) {
    const stdout = results[1].status === "fulfilled" ? results[1].value : "";
    const stderr = results[2].status === "fulfilled" ? results[2].value : "";
    errors.push(new Error(`${cmd.join(" ")} failed (exit ${exit.value}):\n${stdout}\n${stderr}`));
  }
  if (errors.length) throw new AggregateError(errors, "Smoke child failed.");
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "strata-integrations-http-"));
  const children = new Set<ChildOwner>();
  let application: ApplicationOwner | undefined;
  let discovery: ReturnType<typeof Bun.serve> | undefined;
  let reservation: ReturnType<typeof Bun.serve> | undefined;
  let failed = false;
  let primary: unknown;
  const cleanupErrors: unknown[] = [];
  let terminationConfirmed = true;
  try {
    const flags = parseCreateStrataArgs([
      "integrations-smoke",
      "--frontend=server-htmx",
      "--database=sqlite",
      "--auth=cookie",
      "--oauth-github",
      "--oidc",
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

    await runChild(["bun", "install"], app, children);

    await mkdir(join(app, "storage"), { recursive: true });
    const databaseUrl = `sqlite:${join(app, "storage/app.sqlite")}`;
    process.env.DATABASE_URL = databaseUrl;
    process.env.APP_DATABASE_URL = databaseUrl;
    process.env.MIGRATION_DATABASE_URL = databaseUrl;
    process.env.DB_CONNECTION = "sqlite";
    process.env.APP_ENV = "local";
    process.env.FRONTEND_MODE = "server-htmx";
    process.env.TENANCY_DRIVER = "none";
    process.env.SESSION_SECRET = "dev-session-secret-change-me-please-32ch";
    process.env.MAIL_DRIVER = "log";
    process.env.CACHE_DRIVER = "array";
    process.env.QUEUE_DRIVER = "sync";
    let discoveryPort = 0;
    discovery = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/.well-known/openid-configuration") {
          const origin = `http://127.0.0.1:${discoveryPort}`;
          return Response.json({
            issuer: origin,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            jwks_uri: `${origin}/jwks`,
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    if (typeof discovery.port !== "number") {
      throw new Error("OIDC discovery server did not bind a port.");
    }
    discoveryPort = discovery.port;
    const oidcIssuer = `http://127.0.0.1:${discoveryPort}`;

    // Select the advertised callback origin before the application snapshots configuration.
    reservation = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("reserved", { status: 503 }),
    });
    const listenPort = reservation.port;
    assert(typeof listenPort === "number", "Callback origin reservation did not bind a port");
    const publicOrigin = reservation.url.origin;
    await reservation.stop(true);
    reservation = undefined;
    process.env.APP_URL = publicOrigin;
    process.env.OIDC_REDIRECT_URI = `${publicOrigin}/auth/oidc/callback`;
    process.env.GITHUB_REDIRECT_URI = `${publicOrigin}/auth/github/callback`;
    process.env.FEATURE_OAUTH = "true";
    process.env.GITHUB_CLIENT_ID = "test-client-id";
    process.env.GITHUB_CLIENT_SECRET = "test-client-secret";
    process.env.OIDC_ISSUER = oidcIssuer;
    process.env.OIDC_CLIENT_ID = "oidc-client";
    process.env.OIDC_CLIENT_SECRET = "oidc-secret";
    delete process.env.OIDC_ALLOW_PRIVATE;
    process.env.FEATURE_BILLING = "true";
    const stripeWebhookSecret = "whsec_integration_smoke";
    process.env.STRIPE_WEBHOOK_SECRET = stripeWebhookSecret;

    const { createAppServer } = await import(`${join(app, "src/bootstrap/createApp.ts")}`);
    const bootstrapped = await createAppServer({
      migrate: true,
      server: { port: listenPort, native: { hostname: "127.0.0.1" } },
      onConstructed(owner: ApplicationOwner) {
        application = owner;
        return undefined;
      },
    });
    assert(application === bootstrapped.application, "Bootstrap must preserve the captured owner");
    const server = bootstrapped.server;
    assert(server, "HTTP bootstrap did not return its acquired server");
    const origin = server.url.origin;
    assert(origin === publicOrigin, "HTTP listener must match the preconfigured callback origin");

    const login = await fetch(`${origin}/login`);
    assert(login.status === 200, `login status ${login.status}`);
    const loginHtml = await login.text();
    assert(loginHtml.includes("/auth/github"), "login missing GitHub link");
    assert(loginHtml.includes("/auth/oidc"), "login missing OIDC link");

    const github = await fetch(`${origin}/auth/github`, { redirect: "manual" });
    assert(github.status === 302, `github redirect status ${github.status}`);
    assert(
      (github.headers.get("location") ?? "").includes("github.com/login/oauth/authorize"),
      "github location missing authorize URL",
    );
    const githubState = new URL(github.headers.get("location") ?? "").searchParams.get("state");
    assert(githubState, "GitHub redirect missing state");
    assert(
      github.headers.getSetCookie().some((cookie) => cookie.startsWith("oauth_state=")),
      "GitHub redirect missing browser state cookie",
    );
    const unboundGithub = await fetch(
      `${origin}/auth/github/callback?${new URLSearchParams({ code: "attacker-code", state: githubState })}`,
      { redirect: "manual" },
    );
    assert(unboundGithub.status === 403, "GitHub callback accepted another browser's state");
    await unboundGithub.text();

    const oidc = await fetch(`${origin}/auth/oidc`, { redirect: "manual" });
    assert(oidc.status === 302, `oidc redirect status ${oidc.status}`);
    const oidcLocation = oidc.headers.get("location") ?? "";
    assert(oidcLocation.includes(`${oidcIssuer}/authorize`), "oidc location missing authorize URL");
    assert(oidcLocation.includes("code_challenge="), "oidc location missing PKCE challenge");
    assert(
      new URL(oidcLocation).searchParams.get("redirect_uri") ===
        `${publicOrigin}/auth/oidc/callback`,
      "oidc redirect URI must use the preconfigured trusted public origin",
    );
    const pkceCookie = oidc.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("oidc_pkce="));
    assert(pkceCookie, "oidc response missing oidc_pkce cookie");
    const state = new URL(oidcLocation).searchParams.get("state");
    assert(state, "oidc location missing state");
    const callback = await fetch(
      `${origin}/auth/oidc/callback?${new URLSearchParams({ code: "smoke-code", state })}`,
      { headers: { cookie: pkceCookie.split(";")[0] ?? "" } },
    );
    assert(
      callback.status === 400,
      `oidc callback status ${callback.status} (expected 400 after PKCE, not 403)`,
    );
    const callbackJson = (await callback.json()) as { error?: string };
    assert(
      callbackJson.error === "Invalid OIDC response.",
      `oidc callback error ${callbackJson.error ?? ""}`,
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
    for (const accept of [undefined, "text/html"]) {
      const rejected = await fetch(`${origin}/billing/webhooks/stripe`, {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/json",
          "stripe-signature": "invalid",
          ...(accept ? { accept } : {}),
        },
        body: rawBody,
      });
      assert(rejected.status === 401, `invalid stripe signature status ${rejected.status}`);
      assert(
        rejected.headers.get("content-type")?.includes("application/json"),
        "stripe errors must stay JSON",
      );
      assert(
        ((await rejected.json()) as { error?: string }).error ===
          "Invalid Stripe signature header.",
        "stripe signature error contract changed",
      );
    }
    const stripeJson = (await stripe.json()) as { received?: boolean };
    assert(stripeJson.received === true, "stripe webhook body missing received:true");
  } catch (error) {
    failed = true;
    primary = error;
  } finally {
    // Independent owners are joined even when startup or another cleanup failed.
    if (application) {
      try {
        const result = await application.stop({ reason: "SMOKE_COMPLETE" });
        if (!result.successful) {
          terminationConfirmed = false;
          cleanupErrors.push(
            new AggregateError(
              result.snapshot.errors.map((diagnostic) => diagnostic.error),
              `Smoke application cleanup incomplete; retained: ${result.snapshot.retainedResources.join(", ")}`,
            ),
          );
        }
      } catch (error) {
        terminationConfirmed = false;
        cleanupErrors.push(error);
      }
    }
    if (reservation) {
      try {
        await reservation.stop(true);
      } catch (error) {
        terminationConfirmed = false;
        cleanupErrors.push(error);
      }
    }
    if (discovery) {
      try {
        await discovery.stop(true);
      } catch (error) {
        terminationConfirmed = false;
        cleanupErrors.push(error);
      }
    }
    for (const child of children) {
      try {
        child.kill("SIGTERM");
        await child.exited;
        children.delete(child);
      } catch (error) {
        terminationConfirmed = false;
        cleanupErrors.push(error);
      }
    }
    if (terminationConfirmed) {
      try {
        await rm(root, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(error);
      }
    } else {
      console.error(
        `Smoke resources could not be confirmed terminated; fixture retained at ${root}`,
      );
    }
  }
  if (cleanupErrors.length) {
    throw new AggregateError(
      [...(failed ? [primary] : []), ...cleanupErrors],
      "Smoke execution and cleanup failed.",
    );
  }
  if (failed) throw primary;
  console.log(
    "Integration extras smoke passed (GitHub redirect, OIDC PKCE callback, Stripe webhook).",
  );
}

await main();
