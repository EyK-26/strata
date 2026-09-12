import { join } from "node:path";
import { createAppDependencies } from "@getstrata/bootstrap/dependencies";
import { mailer } from "../../core/mail/mailer";
import { envFlagEnabled, isProductionEnv } from "../../core/runtime/appEnv";
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
  if (isProductionEnv() && !envFlagEnabled(process.env.STRATA_TINKER_FORCE)) {
    throw new Error(
      "tinker is disabled in production. Set STRATA_TINKER_FORCE=true only for an emergency break-glass session.",
    );
  }

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
