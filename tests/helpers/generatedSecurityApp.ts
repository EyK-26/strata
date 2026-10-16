import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../packages/strata-starter/src/parseArgs.ts";

const repoRoot = join(import.meta.dir, "../..");

/** Owned acceptance infrastructure; no checked-in app or source-path runtime dependencies. */
export async function createGeneratedSecurityApp() {
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  const runtimeUrl = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
  if (!migrationUrl || !runtimeUrl)
    throw new Error(
      "Generated security acceptance requires migration and restricted runtime Postgres URLs.",
    );
  const root = await mkdtemp(join(tmpdir(), "strata-security-"));
  const app = join(root, "app");
  const databaseName = `generated_security_${crypto.randomUUID().replaceAll("-", "")}`;
  const controlUrl = new URL(migrationUrl);
  controlUrl.pathname = "/postgres";
  const control = new SQL(controlUrl.href);
  let created = false;
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    try {
      if (created) {
        await control.unsafe(`DROP DATABASE ${databaseName} WITH (FORCE)`);
        created = false;
      }
    } finally {
      try {
        await control.close();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  }
  try {
    generateProject({
      projectName: "security-acceptance",
      targetDir: app,
      layers: layersFromFlags(
        parseCreateStrataArgs([
          "security-acceptance",
          "--frontend=server-htmx",
          "--database=postgres",
          "--tenancy=rls",
          "--auth=cookie-token-jwt",
          "--mfa",
          "--email-verification",
          "--scim",
          "--metrics",
          "--yes",
        ]),
      ),
      templateRoot: resolveTemplateRoot(),
      overlayRoot: resolveOverlayRoot(),
    });
    const manifestPath = join(app, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const samlPeer = JSON.parse(
      await readFile(join(repoRoot, "node_modules/@node-saml/node-saml/package.json"), "utf8"),
    );
    // This suite enables SAML at runtime; an external app must install its optional peer.
    manifest.dependencies["@node-saml/node-saml"] = samlPeer.version;
    for (const part of ["core", "bootstrap", "cli"]) {
      const packed = Bun.spawnSync(["npm", "pack", "--silent", "--pack-destination", root], {
        cwd: join(repoRoot, `packages/strata-${part}`),
        stdout: "pipe",
        stderr: "pipe",
        timeout: 30000,
        killSignal: "SIGKILL",
      });
      if (packed.exitCode !== 0)
        throw new Error(
          `Candidate ${part} pack failed: ${new TextDecoder().decode(packed.stderr)}`,
        );
      const filename = new TextDecoder().decode(packed.stdout).trim().split("\n").at(-1);
      if (!filename) throw new Error(`Candidate ${part} pack produced no tarball.`);
      manifest.dependencies[`@getstrata/${part}`] = `file:${join(root, filename)}`;
    }
    await writeFile(manifestPath, JSON.stringify(manifest));
    const install = Bun.spawnSync(["bun", "install", "--prefer-offline"], {
      cwd: app,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30000,
      killSignal: "SIGKILL",
    });
    if (install.exitCode !== 0)
      throw new Error(
        `Generated security installation failed: ${new TextDecoder().decode(install.stderr)}`,
      );
    await control.unsafe(`CREATE DATABASE ${databaseName}`);
    created = true;
    const admin = new URL(migrationUrl),
      runtime = new URL(runtimeUrl);
    admin.pathname = runtime.pathname = `/${databaseName}`;
    return {
      app,
      migrationUrl: admin.href,
      runtimeUrl: runtime.href,
      resolve: createRequire(manifestPath).resolve,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
