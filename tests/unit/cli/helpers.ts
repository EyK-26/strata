import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

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

function cliTestEnv(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") {
      continue;
    }
    if (key.startsWith("BUN_TEST") || key === "NODE_V8_COVERAGE") {
      continue;
    }
    env[key] = value;
  }

  env.MAIL_DRIVER = "log";
  env.CACHE_DRIVER ??= "array";
  env.QUEUE_DRIVER ??= "sync";

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return env;
}

function formatCliResult(result: { stdout: string; stderr: string; exitCode: number }): string {
  return `exit=${result.exitCode}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`;
}

async function runCli(
  args: string[],
  envOverrides?: Record<string, string | undefined>,
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = Bun.spawn(["bun", join(repoRoot, "src/cli/index.ts"), ...args], {
    cwd: repoRoot,
    env: cliTestEnv(envOverrides),
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

export { captureConsole, cliTestEnv, formatCliResult, mockProcessExit, repoRoot, runCli };
