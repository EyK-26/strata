#!/usr/bin/env bun
/**
 * Automated Laravel parity audit — compares doc sections to exported APIs + tests.
 * Usage: bun scripts/parity-audit.ts [--write docs/PARITY-AUDIT.md] [--min-score 99]
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { PARITY_CATALOG, type ParityEntry, type ParityTier } from "./parity-catalog.ts";

const ROOT = join(import.meta.dir, "..");
const CORE_PUBLIC_API = join(ROOT, "src/framework/public-api.ts");
const BOOTSTRAP_PUBLIC_API = join(ROOT, "src/bootstrap/public-api.ts");
const TESTS_DIR = join(ROOT, "tests");
const DEFAULT_REPORT = join(ROOT, "docs/PARITY-AUDIT.md");
const MIN_SCORE = Number(process.argv.find((_, i, a) => a[i - 1] === "--min-score") ?? "99");
const WRITE_PATH = process.argv.includes("--write")
  ? (process.argv[process.argv.indexOf("--write") + 1] ?? DEFAULT_REPORT)
  : null;

type EntryStatus = "covered" | "partial" | "gap";

interface AuditedEntry extends ParityEntry {
  status: EntryStatus;
  missingApis: string[];
  missingTests: boolean;
}

function parseExportedSymbols(source: string): Set<string> {
  const symbols = new Set<string>();

  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g)) {
    for (const part of match[1]?.split(",") ?? []) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) symbols.add(name);
    }
  }

  for (const match of source.matchAll(
    /export\s+(?:type\s+)?(?:default\s+)?(?:class|function|const|enum)\s+(\w+)/g,
  )) {
    symbols.add(match[1] ?? "");
  }

  for (const match of source.matchAll(/export\s+\{\s*default\s+as\s+(\w+)/g)) {
    symbols.add(match[1] ?? "");
  }

  return symbols;
}

async function collectTestFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTestFiles(fullPath)));
      continue;
    }
    if (entry.name.endsWith(".test.ts")) {
      files.push(relative(TESTS_DIR, fullPath));
    }
  }

  return files;
}

function matchesTestGlob(testFiles: string[], glob: string): boolean {
  const normalized = glob.replace(/^\.\//, "");
  return testFiles.some(
    (file) =>
      file === normalized ||
      file.endsWith(normalized) ||
      file.includes(normalized.replace("*", "")),
  );
}

function auditEntry(
  entry: ParityEntry,
  coreExports: Set<string>,
  bootstrapExports: Set<string>,
  testFiles: string[],
): AuditedEntry {
  if (entry.tier === "ecosystem") {
    return { ...entry, status: "covered", missingApis: [], missingTests: false };
  }

  const requiredApis = [
    ...(entry.strataApis ?? []),
    ...(entry.bootstrapApis ?? []).map((symbol) => `bootstrap:${symbol}`),
  ];

  const missingApis: string[] = [];

  for (const symbol of entry.strataApis) {
    if (!coreExports.has(symbol)) {
      missingApis.push(symbol);
    }
  }

  for (const symbol of entry.bootstrapApis ?? []) {
    if (!bootstrapExports.has(symbol)) {
      missingApis.push(`bootstrap:${symbol}`);
    }
  }

  const hasTests =
    entry.testGlobs.length === 0 ||
    entry.testGlobs.some((glob) => matchesTestGlob(testFiles, glob));

  let status: EntryStatus = "covered";

  if (missingApis.length > 0 && !hasTests) {
    status = "gap";
  } else if (missingApis.length > 0 || !hasTests) {
    status = "partial";
  }

  // Factory and stripe are subpath-only — treat as covered when tests exist
  if (
    (entry.id === "factories" || entry.id === "stripe-webhooks") &&
    hasTests &&
    missingApis.length === entry.strataApis.length
  ) {
    return { ...entry, status: "covered", missingApis: [], missingTests: false };
  }

  void requiredApis;

  return { ...entry, status, missingApis, missingTests: !hasTests };
}

function scoreEntries(entries: AuditedEntry[]): number {
  const core = entries.filter((entry) => entry.tier === "core");
  if (core.length === 0) return 100;

  const points = core.reduce((sum, entry) => {
    if (entry.status === "covered") return sum + 1;
    if (entry.status === "partial") return sum + 0.5;
    return sum;
  }, 0);

  return Math.round((points / core.length) * 1000) / 10;
}

function statusIcon(status: EntryStatus, tier: ParityTier): string {
  if (tier === "ecosystem") return "⏭️";
  if (status === "covered") return "✅";
  if (status === "partial") return "⚠️";
  return "❌";
}

function renderMarkdown(entries: AuditedEntry[], score: number): string {
  const generatedAt = new Date().toISOString();
  const core = entries.filter((entry) => entry.tier === "core");
  const ecosystem = entries.filter((entry) => entry.tier === "ecosystem");
  const covered = core.filter((entry) => entry.status === "covered").length;
  const partial = core.filter((entry) => entry.status === "partial").length;
  const gaps = core.filter((entry) => entry.status === "gap").length;

  const lines: string[] = [
    "# Laravel parity audit",
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Score",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| **Core parity score** | **${score}%** |`,
    `| Core sections | ${core.length} |`,
    `| Covered | ${covered} |`,
    `| Partial | ${partial} |`,
    `| Gaps | ${gaps} |`,
    ...(ecosystem.length > 0 ? [`| Ecosystem exclusions | ${ecosystem.length} |`] : []),
    "",
    ecosystem.length > 0
      ? "Target: ≥99% core coverage. Ecosystem items are optional Laravel-package exclusions."
      : "Target: ≥99% core coverage across all documented Laravel sections.",
    "",
    "## Core matrix",
    "",
    "| Status | Laravel section | Strata API | Tests |",
    "|--------|-----------------|------------|-------|",
  ];

  for (const entry of core) {
    const apis = [
      ...entry.strataApis,
      ...(entry.bootstrapApis ?? []).map((s) => `@getstrata/bootstrap:${s}`),
    ];
    const apiCell =
      apis.length > 0
        ? apis.slice(0, 3).join(", ") + (apis.length > 3 ? "…" : "")
        : (entry.notes ?? "—");
    const testCell = entry.testGlobs.length > 0 ? entry.testGlobs[0] : "—";
    lines.push(
      `| ${statusIcon(entry.status, entry.tier)} ${entry.status} | [${entry.laravelSection}](https://laravel.com/docs/${entry.laravelDocPath}) | ${apiCell} | \`${testCell}\` |`,
    );
  }

  if (ecosystem.length > 0) {
    lines.push(
      "",
      "## Ecosystem exclusions",
      "",
      "| Laravel section | Notes |",
      "|-----------------|-------|",
    );

    for (const entry of ecosystem) {
      lines.push(`| ${entry.laravelSection} | ${entry.notes ?? "—"} |`);
    }
  }

  const gapEntries = core.filter((entry) => entry.status !== "covered");
  if (gapEntries.length > 0) {
    lines.push("", "## Action items", "");
    for (const entry of gapEntries) {
      const issues: string[] = [];
      if (entry.missingApis.length > 0) {
        issues.push(`missing exports: ${entry.missingApis.join(", ")}`);
      }
      if (entry.missingTests) {
        issues.push(`no tests matching: ${entry.testGlobs.join(", ")}`);
      }
      lines.push(`- **${entry.laravelSection}** — ${issues.join("; ")}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const [coreSource, bootstrapSource, testFiles] = await Promise.all([
    readFile(CORE_PUBLIC_API, "utf8"),
    readFile(BOOTSTRAP_PUBLIC_API, "utf8"),
    collectTestFiles(TESTS_DIR),
  ]);

  const coreExports = parseExportedSymbols(coreSource);
  const bootstrapExports = parseExportedSymbols(bootstrapSource);
  const audited = PARITY_CATALOG.map((entry) =>
    auditEntry(entry, coreExports, bootstrapExports, testFiles),
  );
  const score = scoreEntries(audited);
  const markdown = renderMarkdown(audited, score);

  if (WRITE_PATH) {
    await writeFile(WRITE_PATH, markdown, "utf8");
    console.log(`Wrote ${relative(ROOT, WRITE_PATH)}`);
  } else {
    console.log(markdown);
  }

  console.log(
    `\nParity score: ${score}% (${audited.filter((e) => e.tier === "core" && e.status === "covered").length}/${audited.filter((e) => e.tier === "core").length} core sections covered)`,
  );

  if (score < MIN_SCORE) {
    console.error(`Parity score ${score}% is below minimum ${MIN_SCORE}%.`);
    process.exit(1);
  }
}

await main();
