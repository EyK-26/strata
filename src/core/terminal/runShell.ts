async function runInteractiveShell(
  command: string[],
  options: { cwd?: string; cols?: number; rows?: number } = {},
): Promise<number> {
  await using terminal = new Bun.Terminal({
    cols: options.cols ?? 120,
    rows: options.rows ?? 30,
  });

  const proc = Bun.spawn(command, {
    terminal,
    cwd: options.cwd,
    stdin: "inherit",
  });

  await proc.exited;
  return proc.exitCode ?? 1;
}

export { runInteractiveShell };
