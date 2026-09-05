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

export function digestBunTestOutput(output: string): string {
  const kept: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (NOISY_LINE.test(line)) {
      continue;
    }
    if (
      /bun test /.test(line) ||
      /\((?:fail|pass|skip|todo)\)/.test(line) ||
      /^\s+\d+ (pass|fail|skip|todo)\s*$/.test(line) ||
      /expect\(\) calls/.test(line) ||
      /tests across/.test(line) ||
      /^\s*error:/i.test(line) ||
      /coverage/i.test(line) ||
      /^\s+\S+\s+\|\s+[\d.]+/.test(line) ||
      /^-+/.test(line) ||
      /File\s+\|/.test(line)
    ) {
      kept.push(line);
    }
  }
  return `${kept.join("\n")}\n`;
}

export function failingTestLines(output: string): string {
  return output
    .split(/\r?\n/)
    .filter((line) => /\(fail\)/.test(line) || /^\s*error:/i.test(line))
    .slice(0, 80)
    .join("\n");
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
