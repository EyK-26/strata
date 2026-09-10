interface CoverageRow {
  file: string;
  funcs: number;
  lines: number;
}

interface CoverageEvaluation {
  uncovered: CoverageRow[];
  neverLoaded: string[];
  staleExemptions: string[];
  redeemable: string[];
  enforcedCount: number;
  exemptCount: number;
}

const COVERAGE_ROW_PATTERN = /^\s*(src\/\S+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/;

const COMMENT_PATTERN = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

function parseCoverageRows(output: string): CoverageRow[] {
  const rows: CoverageRow[] = [];
  const seen = new Set<string>();

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(COVERAGE_ROW_PATTERN);
    if (!match) {
      continue;
    }

    const file = match[1] ?? "";
    if (!file || seen.has(file)) {
      continue;
    }

    seen.add(file);
    rows.push({ file, funcs: Number(match[2]), lines: Number(match[3]) });
  }

  return rows;
}

function isTypeOnlyModule(transpiledJs: string): boolean {
  return transpiledJs.replace(COMMENT_PATTERN, "").trim().length === 0;
}

function evaluateCoverage(input: {
  rows: readonly CoverageRow[];
  sourceFiles: readonly string[];
  exemptFiles: readonly string[];
  typeOnlyFiles?: readonly string[];
}): CoverageEvaluation {
  const exempt = new Set(input.exemptFiles);
  const onDisk = new Set(input.sourceFiles);
  const typeOnly = new Set(input.typeOnlyFiles ?? []);
  const reported = new Map(input.rows.map((row) => [row.file, row]));

  const uncovered: CoverageRow[] = [];
  const neverLoaded: string[] = [];
  let enforcedCount = 0;

  for (const file of [...onDisk].sort()) {
    if (exempt.has(file)) {
      continue;
    }

    enforcedCount += 1;
    const row = reported.get(file);

    if (!row) {
      if (!typeOnly.has(file)) {
        neverLoaded.push(file);
      }
      continue;
    }

    if (row.lines < 100) {
      uncovered.push(row);
    }
  }

  const staleExemptions = input.exemptFiles.filter((file) => !onDisk.has(file)).sort();
  const redeemable = input.exemptFiles
    .filter((file) => onDisk.has(file) && (reported.get(file)?.lines ?? 0) >= 100)
    .sort();

  return {
    uncovered,
    neverLoaded,
    staleExemptions,
    redeemable,
    enforcedCount,
    exemptCount: input.exemptFiles.length,
  };
}

function checkRatchet(exemptCount: number, limit: number): string[] {
  const errors: string[] = [];

  if (exemptCount > limit) {
    errors.push(
      `Coverage exemptions grew from ${limit} to ${exemptCount}. New files must be tested, not exempted.`,
    );
  }

  if (exemptCount < limit) {
    errors.push(
      `Coverage exemptions dropped to ${exemptCount}; lower COVERAGE_EXEMPT_LIMIT to ${exemptCount} to lock the win in.`,
    );
  }

  return errors;
}

export type { CoverageEvaluation, CoverageRow };
export { checkRatchet, evaluateCoverage, isTypeOnlyModule, parseCoverageRows };
