import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { createConnection } from "mysql2/promise";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../packages/strata-starter/src/parseArgs.ts";
import { candidatePackage } from "../../scripts/candidate-packages";
import { GeneratedSecurityAppOwner } from "./generatedSecurityAppOwner";

const repoRoot = join(import.meta.dir, "../..");

/** Owned acceptance infrastructure; no checked-in app or source-path runtime dependencies. */
export async function createGeneratedSecurityApp(
  database: "postgres" | "sqlite" | "mysql" = "postgres",
  extraFlags: readonly string[] = [],
  options: { publishedVersion?: string; parentDirectory?: string; reference?: "work-tracker" } = {},
) {
  if (options.publishedVersion && options.reference)
    throw new Error(
      "Reference selection requires the candidate generator; the published CLI has no reference option.",
    );
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  const runtimeUrl = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
  if (database === "postgres" && (!migrationUrl || !runtimeUrl))
    throw new Error(
      "Generated security acceptance requires migration and restricted runtime Postgres URLs.",
    );
  const mysqlUrl = process.env.MYSQL_OBSERVABILITY_ADMIN_URL;
  if (database === "mysql" && !mysqlUrl?.trim())
    throw new Error("Generated MySQL acceptance requires MYSQL_OBSERVABILITY_ADMIN_URL.");
  if (!["postgres", "sqlite", "mysql"].includes(database))
    throw new Error("Invalid generated fixture database.");
  if (options.publishedVersion !== undefined && !/^\d+\.\d+\.\d+$/.test(options.publishedVersion))
    throw new Error("Exact published version required.");
  if (
    options.parentDirectory !== undefined &&
    (typeof options.parentDirectory !== "string" || !options.parentDirectory.trim())
  )
    throw new Error("Invalid generated fixture parent directory.");
  const admin =
    database === "postgres"
      ? new URL(migrationUrl as string)
      : database === "mysql"
        ? new URL(mysqlUrl as string)
        : undefined;
  const runtime = database === "postgres" ? new URL(runtimeUrl as string) : undefined;
  if (
    admin &&
    !(database === "postgres" ? ["postgres:", "postgresql:"] : ["mysql:"]).includes(admin.protocol)
  )
    throw new Error("Invalid generated fixture admin URL protocol.");
  if (runtime && !["postgres:", "postgresql:"].includes(runtime.protocol))
    throw new Error("Invalid generated fixture runtime URL protocol.");
  const flags = [
    "--frontend=server-htmx",
    `--database=${database}`,
    database === "postgres" ? "--tenancy=rls" : "--tenancy=column",
    "--auth=cookie-token-jwt",
    "--mfa",
    "--email-verification",
    "--scim",
    "--metrics",
    ...extraFlags,
    "--yes",
  ];
  const layers = layersFromFlags(parseCreateStrataArgs(["security-acceptance", ...flags]));
  const databaseName = `generated_security_${crypto.randomUUID().replaceAll("-", "")}`;
  const mysqlUser = `q01_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
  const owner = new GeneratedSecurityAppOwner(databaseName, mysqlUser);
  const setup = (async () => {
    owner.admit();
    const root = await mkdtemp(join(options.parentDirectory ?? tmpdir(), "strata-security-"));
    owner.root = root;
    owner.admit();
    const app = join(root, "app");
    if (database === "postgres") {
      const controlUrl = new URL(admin as URL);
      controlUrl.pathname = "/postgres";
      owner.connectionAttempted = true;
      owner.postgres = new SQL(controlUrl.href);
    }
    if (options.publishedVersion) {
      if (!/^\d+\.\d+\.\d+$/.test(options.publishedVersion))
        throw new Error("Exact published version required.");
      await owner.runChild(
        ["bun", "x", "--bun", `create-strata@${options.publishedVersion}`, "app", ...flags],
        root,
        60000,
      );
      // Registry qualification pins the requested release rather than allowing
      // an older generator's caret ranges to install a newer runtime silently.
      owner.admit();
      const manifestPath = join(app, "package.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      for (const part of ["core", "bootstrap", "cli"])
        manifest.dependencies[`@getstrata/${part}`] = options.publishedVersion;
      owner.admit();
      await writeFile(manifestPath, JSON.stringify(manifest));
      await owner.runChild(["bun", "install"], app, 60000);
      for (const part of ["core", "bootstrap", "cli"] as const) {
        const manifest = JSON.parse(
          await readFile(join(app, `node_modules/@getstrata/${part}/package.json`), "utf8"),
        );
        if (manifest.version !== options.publishedVersion)
          throw new Error(`Unexpected published ${part} version: ${manifest.version}`);
      }
    } else {
      owner.admit();
      generateProject({
        projectName: "security-acceptance",
        reference: options.reference,
        targetDir: app,
        layers,
        templateRoot: resolveTemplateRoot(),
        overlayRoot: resolveOverlayRoot(),
      });
      owner.admit();
      const manifestPath = join(app, "package.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const samlPeer = JSON.parse(
        await readFile(join(repoRoot, "node_modules/@node-saml/node-saml/package.json"), "utf8"),
      );
      // This suite enables SAML at runtime; an external app must install its optional peer.
      manifest.dependencies["@node-saml/node-saml"] = samlPeer.version;
      for (const part of ["core", "bootstrap", "cli"] as const) {
        owner.admit();
        manifest.dependencies[`@getstrata/${part}`] = `file:${await candidatePackage(part, root)}`;
      }
      owner.admit();
      await writeFile(manifestPath, JSON.stringify(manifest));
      await owner.runChild(["bun", "install", "--prefer-offline"], app, 30000);
    }
    let adminUrl: string;
    let appUrl: string;
    owner.admit();
    if (database === "postgres") {
      const control = owner.postgres;
      if (!control || !admin || !runtime) throw new Error("Missing Postgres fixture credentials.");
      owner.database = "attempted";
      await control.unsafe(`CREATE DATABASE ${databaseName}`);
      owner.database = "acquired";
      owner.admit();
      admin.pathname = runtime.pathname = `/${databaseName}`;
      adminUrl = admin.href;
      appUrl = runtime.href;
    } else if (database === "mysql") {
      if (!mysqlUrl || !admin) throw new Error("Missing MySQL fixture credentials.");
      owner.connectionAttempted = true;
      const mysqlControl = await createConnection(mysqlUrl);
      owner.mysql = mysqlControl;
      owner.admit();
      owner.database = "attempted";
      await mysqlControl.query(`CREATE DATABASE ${databaseName}`);
      owner.database = "acquired";
      owner.admit();
      const password = crypto.randomUUID().replaceAll("-", "");
      owner.user = "attempted";
      await mysqlControl.query(`CREATE USER '${mysqlUser}'@'%' IDENTIFIED BY '${password}'`);
      owner.user = "acquired";
      owner.admit();
      await mysqlControl.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ${databaseName}.* TO '${mysqlUser}'@'%'`,
      );
      owner.admit();
      admin.pathname = `/${databaseName}`;
      const runtime = new URL(admin);
      runtime.username = mysqlUser;
      runtime.password = password;
      adminUrl = admin.href;
      appUrl = runtime.href;
    } else {
      adminUrl = appUrl = `sqlite:${join(root, "acceptance.sqlite")}`;
    }
    return {
      app,
      migrationUrl: adminUrl,
      runtimeUrl: appUrl,
      resolve: createRequire(join(app, "package.json")).resolve,
      close: owner.close,
    };
  })();
  try {
    const fixture = await owner.observeSetup(setup);
    owner.handoff();
    return fixture;
  } catch (error) {
    return owner.failSetup(error);
  }
}
