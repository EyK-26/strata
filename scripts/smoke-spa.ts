/**
 * Hybrid SPA smoke. Builds frontend/dist for a generated app and fetches /app.
 * A separate generated server-HTMX fixture covers the ordinary HTTP runtime.
 */
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
  const root = await mkdtemp(join(tmpdir(), "strata-spa-smoke-"));
  const children = new Set<ChildOwner>();
  let application: ApplicationOwner | undefined;
  let failed = false;
  let primary: unknown;
  const cleanupErrors: unknown[] = [];
  let terminationConfirmed = true;
  try {
    const flags = parseCreateStrataArgs([
      "spa-smoke",
      "--frontend=hybrid",
      "--database=sqlite",
      "--auth=headers",
      "--yes",
    ]);
    const app = join(root, "spa-smoke");
    generateProject({
      projectName: "spa-smoke",
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
    await runChild(["bun", "run", "frontend:install"], app, children);
    await runChild(["bun", "run", "frontend:build"], app, children);

    await mkdir(join(app, "storage"), { recursive: true });
    const databaseUrl = `sqlite:${join(app, "storage/app.sqlite")}`;
    process.env.DATABASE_URL = databaseUrl;
    process.env.APP_DATABASE_URL = databaseUrl;
    process.env.MIGRATION_DATABASE_URL = databaseUrl;
    process.env.DB_CONNECTION = "sqlite";
    process.env.APP_ENV = "local";
    process.env.APP_URL = "http://127.0.0.1:3000";
    process.env.FRONTEND_MODE = "hybrid";
    process.env.SPA_PREFIX = "/app";
    process.env.AUTH_DEV_HEADERS = "true";
    process.env.TENANCY_DRIVER = "none";
    process.env.MAIL_DRIVER = "log";
    process.env.CACHE_DRIVER = "array";
    process.env.QUEUE_DRIVER = "sync";

    const { createAppServer } = await import(`${join(app, "src/bootstrap/createApp.ts")}`);
    const bootstrapped = await createAppServer({
      migrate: true,
      server: { port: 0, native: { hostname: "127.0.0.1" } },
      onConstructed(owner: ApplicationOwner) {
        application = owner;
        return undefined;
      },
    });
    assert(application === bootstrapped.application, "Bootstrap must preserve the captured owner");
    const server = bootstrapped.server;
    assert(server, "HTTP bootstrap did not return its acquired server");
    const origin = server.url.origin;

    const spa = await fetch(`${origin}/app`);
    const html = await spa.text();
    assert(spa.status === 200, `GET /app status ${spa.status}: ${html.slice(0, 180)}`);
    assert(
      !html.includes("SPA build not found"),
      "GET /app still reports a missing frontend build",
    );
    assert(html.includes('id="root"'), "GET /app did not serve the SPA document");
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
  console.log("Hybrid SPA smoke passed (frontend:build then GET /app).");
}

await main();
