import { runInteractiveShell } from "@getstrata/core/terminal/runShell";

async function shellCommand(): Promise<void> {
  const shell = process.env.SHELL?.trim() || "/bin/sh";
  const exitCode = await runInteractiveShell([shell], { cwd: process.cwd() });
  process.exitCode = exitCode;
}

export { shellCommand };
