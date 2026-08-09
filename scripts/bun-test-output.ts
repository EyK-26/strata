/**
 * Shared helpers for coverage gates. Bun test + MAIL_DRIVER=log used to dump
 * full HTML into the captured stream, so a naive `\\n 0 fail\\n` search either
 * false-failed or drowned GitHub logs.
 */

async function readPipedText(
  stream: ReadableStream<Uint8Array> | number | undefined,
): Promise<string> {
  if (stream == null || typeof stream === "number") {
    return "";
  }
  return new Response(stream).text();
}

export async function collectSpawnOutput(proc: {
  stdout: ReadableStream<Uint8Array> | number | undefined;
  stderr: ReadableStream<Uint8Array> | number | undefined;
  exited: Promise<number>;
}): Promise<{
  exitCode: number;
  output: string;
}> {
  const [stdout, stderr, exitCode] = await Promise.all([
    readPipedText(proc.stdout),
    readPipedText(proc.stderr),
    proc.exited,
  ]);
  return { exitCode, output: `${stdout}${stderr}` };
}

export function parseLastFailCount(output: string): number | null {
  let last: number | null = null;
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+) fail\s*$/);
    if (match) {
      last = Number(match[1]);
    }
  }
  return last;
}

export function bunTestsFailed(output: string, exitCode: number): boolean {
  if (exitCode !== 0) {
    return true;
  }
  const fails = parseLastFailCount(output);
  return fails === null || fails > 0;
}

const NOISY_LINE = /"channel":"mail"|<!DOCTYPE html>/i;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const MAX_ERROR_BLOCK_LINES = 40;

function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

function isSummaryBoundary(line: string): boolean {
  return (
    /\((?:fail|pass|skip|todo)\)/.test(line) ||
    /^\s+\d+ (pass|fail|skip|todo)\s*$/.test(line) ||
    /^bun test /.test(line)
  );
}

function shouldKeepLine(line: string): boolean {
  return (
    /bun test /.test(line) ||
    /\((?:fail|pass|skip|todo)\)/.test(line) ||
    /^\s+\d+ (pass|fail|skip|todo)\s*$/.test(line) ||
    /expect\(\) calls/.test(line) ||
    /tests across/.test(line) ||
    /^\s*error:/i.test(line) ||
    /expected:|received:/i.test(line) ||
    /^\s+at\s+/.test(line) ||
    /coverage/i.test(line) ||
    /^\s+\S+\s+\|\s+[\d.]+/.test(line) ||
    /^-+/.test(line) ||
    /File\s+\|/.test(line)
  );
}

export function digestBunTestOutput(output: string): string {
  const kept: string[] = [];
  let errorBlockRemaining = 0;

  for (const rawLine of output.split(/\r?\n/)) {
    if (NOISY_LINE.test(rawLine)) {
      continue;
    }

    const line = stripAnsi(rawLine);

    if (/^\s*error:/i.test(line)) {
      errorBlockRemaining = MAX_ERROR_BLOCK_LINES;
      kept.push(line);
      continue;
    }

    if (errorBlockRemaining > 0) {
      if (isSummaryBoundary(line)) {
        errorBlockRemaining = 0;
      } else {
        kept.push(line);
        errorBlockRemaining -= 1;
        continue;
      }
    }

    if (shouldKeepLine(line)) {
      kept.push(line);
    }
  }

  return `${kept.join("\n")}\n`;
}

export function failingTestLines(output: string): string {
  const kept: string[] = [];
  let errorBlockRemaining = 0;

  for (const rawLine of output.split(/\r?\n/)) {
    if (NOISY_LINE.test(rawLine)) {
      continue;
    }

    const line = stripAnsi(rawLine);

    if (/\(fail\)/.test(line) || /^\s*error:/i.test(line)) {
      kept.push(line);
      errorBlockRemaining = /^\s*error:/i.test(line) ? MAX_ERROR_BLOCK_LINES : 0;
      continue;
    }

    if (errorBlockRemaining > 0) {
      if (isSummaryBoundary(line)) {
        errorBlockRemaining = 0;
        continue;
      }
      kept.push(line);
      errorBlockRemaining -= 1;
    }
  }

  return kept.slice(0, 120).join("\n");
}

export function reportBunTestFailure(label: string, output: string, exitCode: number): void {
  const fails = parseLastFailCount(output);
  console.error(
    `${label} tests failed. bun test exit ${exitCode}; fail count ${fails === null ? "missing" : fails}.`,
  );
  const details = failingTestLines(output);
  if (details.length > 0) {
    console.error(details);
  }
}
