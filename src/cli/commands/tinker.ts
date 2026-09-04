import { join } from "node:path";
import { createAppDependencies } from "@getstrata/bootstrap/dependencies";
import { mailer } from "../../core/mail/mailer";
import { storage } from "../../core/storage/storage";

interface TinkerContext {
  container: ReturnType<typeof createAppDependencies>["container"];
  dependencies: ReturnType<typeof createAppDependencies>;
  mailer: typeof mailer;
  storage: typeof storage;
}

function createTinkerContext(): TinkerContext {
  const dependencies = createAppDependencies();
  return {
    container: dependencies.container,
    dependencies,
    mailer,
    storage,
  };
}

function assignTinkerGlobals(context: TinkerContext): void {
  Object.assign(globalThis, {
    container: context.container,
    dependencies: context.dependencies,
    mailer: context.mailer,
    storage: context.storage,
  });
}

async function tinkerCommand(): Promise<void> {
  const context = createTinkerContext();
  assignTinkerGlobals(context);

  const preloadPath = join(import.meta.dir, "tinkerPreload.ts");
  const proc = Bun.spawn(["bun", "repl", "--preload", preloadPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

export type { TinkerContext };
export { assignTinkerGlobals, createTinkerContext, tinkerCommand };
