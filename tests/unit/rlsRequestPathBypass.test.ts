import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScanner, SyntaxKind } from "typescript/unstable/ast";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../packages/strata-starter/src/parseArgs.ts";
import profiles from "../fixtures/scaffolds/starter-rendering-canonical.sha256.json";
import { createGeneratedSourceApps } from "../helpers/generatedSourceApps";

const generated = createGeneratedSourceApps();
const integrationsRoot = await mkdtemp(join(tmpdir(), "strata-rls-fence-"));
const integrations = join(integrationsRoot, "app");
const integrationProfile = profiles.find(
  (profile) => profile.name === "postgres-hybrid-combined-rls",
);
if (!integrationProfile) throw new Error("Missing existing integration source profile");
generateProject({
  projectName: "rls-fence",
  targetDir: integrations,
  layers: layersFromFlags(parseCreateStrataArgs(integrationProfile.args)),
  templateRoot: resolveTemplateRoot(),
  overlayRoot: resolveOverlayRoot(),
});
afterAll(async () => {
  generated.close();
  await rm(integrationsRoot, { recursive: true, force: true });
});
const repoRoot = join(import.meta.dir, "../..");

async function listTsFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listTsFiles(path)));
    else if (entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

/** Lexical fence, not a dataflow proof. Includes indirect policy objects, ignores
 * comments/string examples, and scans emitted request code rather than render templates. */
function unboundedPolicies(source: string): number[] {
  const scanner = createScanner(true, undefined, source);
  const tokens: Array<{ text: string; position: number; kind: SyntaxKind }> = [];
  const templates: number[] = [];
  let scanned = 0;
  for (;;) {
    if (++scanned > source.length + 1) throw new Error("Source scanner did not terminate");
    let kind = scanner.scan();
    if (kind === SyntaxKind.EndOfFile) break;
    if (kind === SyntaxKind.SlashToken || kind === SyntaxKind.SlashEqualsToken) {
      const previous = tokens.at(-1)?.kind;
      const expressionEnd: readonly SyntaxKind[] = [
        SyntaxKind.Identifier,
        SyntaxKind.NumericLiteral,
        SyntaxKind.StringLiteral,
        SyntaxKind.NoSubstitutionTemplateLiteral,
        SyntaxKind.TemplateTail,
        SyntaxKind.CloseParenToken,
        SyntaxKind.CloseBracketToken,
        SyntaxKind.PlusPlusToken,
        SyntaxKind.MinusMinusToken,
      ];
      if (previous === undefined || !expressionEnd.includes(previous))
        kind = scanner.reScanSlashToken();
    }
    if (kind === SyntaxKind.TemplateHead) templates.push(0);
    else if (kind === SyntaxKind.OpenBraceToken && templates.length)
      templates[templates.length - 1] = (templates.at(-1) ?? 0) + 1;
    else if (kind === SyntaxKind.CloseBraceToken && templates.length) {
      if (templates.at(-1) === 0) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === SyntaxKind.TemplateTail) templates.pop();
      } else templates[templates.length - 1] = (templates.at(-1) ?? 1) - 1;
    }
    tokens.push({
      text:
        kind === SyntaxKind.StringLiteral || kind === SyntaxKind.Identifier
          ? scanner.getTokenValue()
          : scanner.getTokenText(),
      position: scanner.getTokenStart(),
      kind,
    });
  }
  const positions: number[] = [];
  for (const [index, token] of tokens.entries()) {
    const fieldEnd =
      tokens[index + 1]?.text === "]" && tokens[index - 1]?.text === "[" ? index + 2 : index + 1;
    if (
      ["kind", "postgresPolicy"].includes(token.text) &&
      tokens[fieldEnd]?.text === ":" &&
      tokens[fieldEnd + 1]?.kind === SyntaxKind.StringLiteral &&
      tokens[fieldEnd + 1]?.text === "bypass"
    )
      positions.push(token.position);
    if (
      token.text === "runWithMigrationBypass" &&
      tokens[index + 1]?.text === "(" &&
      tokens[index - 1]?.text !== "function"
    )
      positions.push(token.position);
  }
  return positions;
}

// Exact positive inventory, including the policy implementation/type contract.
// A new occurrence even in an allowed file fails; these are specific trusted owners.
const allowed: Readonly<Record<string, number>> = {
  "src/core/contracts/persistence.ts": 1,
  "src/core/tenant/scopedDatabasePolicy.ts": 1,
  "src/core/tenant/databaseTenantContext.ts": 1,
  "src/core/database/ownedReadOnlyObservation.ts": 1,
  "src/core/events/outbox/index.ts": 2,
  "src/bootstrap/providers/queue.ts": 1,
  "src/cli/commands/scheduleRun.ts": 1,
  "generated.rls/src/bootstrap/createApp.ts": 1,
  "generated.rls/src/bootstrap/providers/index.ts": 1,
  "generated.rls/src/cli/initialAdmin.ts": 1,
  "generated.rls/src/db/migrate.ts": 1,
  "generated.team/src/bootstrap/createApp.ts": 1,
  "generated.team/src/bootstrap/providers/index.ts": 1,
  "generated.integrations/src/bootstrap/createApp.ts": 1,
  "generated.integrations/src/bootstrap/providers/index.ts": 1,
  "generated.integrations/src/cli/initialAdmin.ts": 1,
  "generated.integrations/src/db/migrate.ts": 1,
};
function unexpected(inventory: Readonly<Record<string, number>>) {
  return Object.entries(inventory).filter(([file, count]) => count !== (allowed[file] ?? 0));
}
async function sourceInventory() {
  const sources = new Map<string, string>();
  for (const [prefix, root] of [
    ["src/core", join(repoRoot, "src/core")],
    ["src/bootstrap", join(repoRoot, "src/bootstrap")],
    ["src/cli", join(repoRoot, "src/cli")],
    ["generated.rls/src", join(generated.rls, "src")],
    ["generated.team/src", join(generated.team, "src")],
    ["generated.integrations/src", join(integrations, "src")],
  ] as const) {
    const files = await listTsFiles(root);
    expect(files.length, root).toBeGreaterThan(0);
    for (const file of files)
      sources.set(`${prefix}/${file.slice(root.length + 1)}`, await readFile(file, "utf8"));
  }
  return sources;
}

describe("request-path RLS bypass fence", () => {
  test("all current explicit bypass declarations have their exact trusted owner inventory", async () => {
    const sources = await sourceInventory();
    for (const profile of ["rls", "team", "integrations"]) {
      for (const file of [
        "src/modules/auth/index.ts",
        "src/bootstrap/authDirectory.ts",
        "src/bootstrap/createApp.ts",
      ])
        expect(sources.has(`generated.${profile}/${file}`), file).toBe(true);
      if (profile !== "team")
        expect(sources.has(`generated.${profile}/src/modules/scim/index.ts`)).toBe(true);
      if (profile === "integrations")
        expect(sources.has("generated.integrations/src/modules/billing/index.ts")).toBe(true);
    }
    const inventory: Record<string, number> = {};
    for (const [file, text] of sources) {
      let count: number;
      try {
        count = unboundedPolicies(text).length;
      } catch (error) {
        throw new Error(`Cannot scan ${file}`, { cause: error });
      }
      if (count) inventory[file] = count;
    }
    expect(unexpected(inventory)).toEqual([]);
    expect(inventory).toEqual(allowed); // Nonvacuous: required administrative/worker positives cannot disappear.
  });

  test("an injected current request-path bypass is rejected, including an indirect object", async () => {
    const request = await readFile(join(generated.rls, "src/modules/auth/index.ts"), "utf8");
    expect(unboundedPolicies(request)).toHaveLength(0);
    for (const injection of [
      'ports.policy.run(ports.database, { kind: "bypass" }, business);',
      "const elevated = { 'kind': 'bypass' } as const; ports.policy.run(ports.database, elevated, business);",
      "runWithMigrationBypass(ports.database, ports.policy, business);",
      `const before = \`tenant-\${scope.id}\`; ports.policy.run(ports.database, { ["kind"]: "bypass" }, business);`,
    ]) {
      const count = unboundedPolicies(`${request}\n${injection}`).length;
      expect(count).toBe(1);
      expect(unexpected({ "generated.rls/src/modules/auth/index.ts": count })).toEqual([
        ["generated.rls/src/modules/auth/index.ts", 1],
      ]);
    }
    // An allowed composition file cannot hide an added HTTP bypass either.
    const composition = await readFile(join(generated.rls, "src/bootstrap/createApp.ts"), "utf8");
    expect(unboundedPolicies(composition)).toHaveLength(1);
    const injectedComposition = `${composition}\nconst unauthorizedHttp = ports => ports.policy.run(ports.database,{kind:"bypass"},handler);`;
    expect(
      unexpected({
        "generated.rls/src/bootstrap/createApp.ts": unboundedPolicies(injectedComposition).length,
      }),
    ).toHaveLength(1);
    expect(
      unboundedPolicies(
        '// policy.run(db, {kind:"bypass"}, work);\nconst example = \'{kind:"bypass"}\';',
      ),
    ).toHaveLength(0);
  });

  test("initial-admin privilege stays in the operator command with live role checks and cleanup", async () => {
    const command = await readFile(join(generated.rls, "src/cli/initialAdmin.ts"), "utf8");
    expect(unboundedPolicies(command)).toHaveLength(1);
    expect(command).toContain('policy: "cli.initial-admin"');
    expect(command).toContain("await assertRlsLiveDatabaseRole(");
    expect(command.indexOf("await assertRlsLiveDatabaseRole(")).toBeLessThan(
      command.indexOf('ports.policy.run(ports.database, {kind:"bypass"}, provision)'),
    );
    expect(command).toContain("const provision = async (db: TransactionSession)");
    expect(command).toMatch(/finally\s*\{\s*await app.context.dispose\(\)/);
    for (const app of [generated.rls, generated.team]) {
      for (const directory of ["src/modules", "src/bootstrap"]) {
        for (const file of await listTsFiles(join(app, directory))) {
          const source = await readFile(file, "utf8");
          expect(source, file).not.toContain("initialAdminCommand");
          expect(source, file).not.toContain("cli/initialAdmin");
        }
      }
    }
  });

  test("outbox publication is owned by the supplied transaction, and coordination rejects an active business transaction", async () => {
    const source = await readFile(join(repoRoot, "src/core/events/outbox/index.ts"), "utf8");
    const start = source.indexOf("  publish(");
    const end = source.indexOf("  private async persist(", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const publish = source.slice(start, end);
    expect(unboundedPolicies(publish)).toHaveLength(0);
    expect(publish).not.toContain("privileged(");
    expect(publish).toContain("assertOwnedSession(this.owner, db, true)");
    expect(publish).toContain("Outbox publication tenant must match its immutable execution.");
    expect(publish).toContain("return db.transaction(");
    const process = source.slice(
      source.indexOf("  private processOwned("),
      source.indexOf("  private processOwned(") + 900,
    );
    expect(process).toContain("assertNoOwnedTransaction(this.owner)");
    expect(process.indexOf("assertNoOwnedTransaction(this.owner)")).toBeLessThan(
      process.indexOf("this.owner.invoke("),
    );
    const privileged = source.slice(
      source.indexOf("  private async privileged"),
      source.indexOf("  private async privileged") + 1100,
    );
    expect(unboundedPolicies(privileged)).toHaveLength(1);
    expect(privileged).toContain(`policy: \`outbox.\${phase}\``);
    expect(privileged).toContain("assertOwnedSession(this.owner, ports.database)");
  });

  test("generated seed bypass is development-only and owns its application", async () => {
    const seed = await readFile(join(generated.rls, "src/db/migrate.ts"), "utf8");
    expect(unboundedPolicies(seed)).toHaveLength(1);
    expect(seed).toContain('if (isProductionEnv()) throw new Error("Demo seeding is disabled');
    expect(seed).toContain('policy.run(database, {kind:"bypass"}, writeSeed)');
    expect(seed).toContain('policy:"starter-demo-seed"');
    expect(seed).toMatch(/finally\s*\{\s*await application.stop\(\)/);
  });

  test("worker audit composition owns bypass, while webhook jobs use their established queue database", async () => {
    const bootstrap = await readFile(join(generated.rls, "src/bootstrap/createApp.ts"), "utf8");
    const providers = await readFile(
      join(generated.rls, "src/bootstrap/providers/index.ts"),
      "utf8",
    );
    expect(unboundedPolicies(providers)).toHaveLength(1);
    expect(providers).toContain('policy:"audit.export"');
    expect(providers).toContain('policy.run(database,{kind:"bypass"},work)');
    expect(bootstrap).toContain(
      'createOwnedReadOnlyObservation(handle.application,"main",dbOptions,{postgresPolicy:"bypass"})',
    );
    const job = await readFile(
      join(integrations, "src/jobs/dispatchOutboundWebhookJob.ts"),
      "utf8",
    );
    expect(unboundedPolicies(job)).toHaveLength(0);
    expect(job).toContain("Webhook delivery requires an owned queue invocation.");
    expect(job).toContain("await context.database.execute({");
    expect(
      unboundedPolicies(await readFile(join(integrations, "src/modules/billing/index.ts"), "utf8")),
    ).toHaveLength(0);
  });
});

test("outbox metrics bypass is confined to owned, bounded read-only platform observation", async () => {
  const collector = await readFile(join(repoRoot, "src/core/events/outbox/metrics.ts"), "utf8");
  const owner = await readFile(
    join(repoRoot, "src/core/database/ownedReadOnlyObservation.ts"),
    "utf8",
  );
  expect(unboundedPolicies(collector)).toHaveLength(0);
  expect(unboundedPolicies(owner)).toHaveLength(1);
  expect(collector).toContain("options.observeReadOnly(timeoutMs");
  expect(owner).toContain("assertNoOwnedTransaction(");
  expect(owner).toContain("SET TRANSACTION READ ONLY");
  expect(owner).toContain("statement_timeout");
  expect(owner).toContain("acquisitionSignal: scope.context.signal");
  expect(collector).toContain("LIMIT $1");
  expect(collector).not.toContain("SELECT payload");
  const routes = await readFile(join(repoRoot, "src/bootstrap/metricsRoutes.ts"), "utf8");
  expect(routes.indexOf("if (!authorizeMetrics(request))")).toBeLessThan(
    routes.indexOf("(await collect())"),
  );
  expect(routes).toMatch(
    /!options\.queue\s*&&\s*!options\.outbox\s*&&\s*!options\.tracing\s*&&\s*!options\.transactionAcquisition\s*&&\s*!options\.failedJobs/,
  );
});

test("failed-job observation projects bounded IDs without an RLS bypass", async () => {
  const collector = await readFile(join(repoRoot, "src/core/queue/failedJobMetrics.ts"), "utf8");
  expect(collector).toContain("options.observeReadOnly(timeoutMs");
  expect(collector).toContain(
    'select: [{ kind: "column", table: failedJobTable.name, column: "id" }]',
  );
  expect(collector).toContain("limit: sampleLimit + 1");
  expect(collector).toContain("NOT c.relrowsecurity");
  expect(collector).toContain("i.indisprimary");
  expect(unboundedPolicies(collector)).toHaveLength(0);
  expect(collector).not.toContain("listRecent(");
  expect(collector).not.toContain('column: "payload"');
});
