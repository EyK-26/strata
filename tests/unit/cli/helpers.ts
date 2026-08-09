function captureConsole(): {
  logs: string[];
  errors: string[];
  restore: () => void;
} {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };

  return {
    logs,
    errors,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

function mockProcessExit(): {
  getCode: () => number | null;
  restore: () => void;
} {
  let code: number | null = null;
  const originalExit = process.exit;

  process.exit = ((exitCode?: number) => {
    code = exitCode ?? 0;
    throw new Error("process.exit");
  }) as typeof process.exit;

  return {
    getCode: () => code,
    restore: () => {
      process.exit = originalExit;
    },
  };
}

async function runCli(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.ts", ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

export { captureConsole, mockProcessExit, runCli };
