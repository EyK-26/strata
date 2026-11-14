import { join } from "node:path";
import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import type { Application } from "@getstrata/core/contracts/application";
import type { PersistenceInvocation } from "@getstrata/core/contracts/persistence";
import { createMailDriver, Mailer } from "../../core/mail/mailer";
import { envFlagEnabled, isProductionEnv } from "../../core/runtime/appEnv";
import type { Storage } from "../../core/storage/storage";
import { bootQueueApplication } from "./queueApplication";

interface TinkerContext {
  container: AppDependencies["container"];
  dependencies: AppDependencies;
  application: Application;
  invoke: PersistenceInvocation;
  stop(): Promise<void>;
  mailer: () => Mailer;
  storage: () => Storage;
}

async function createTinkerContext(): Promise<TinkerContext> {
  const env = Object.freeze({ ...process.env });
  const scopedMailer = new Mailer(createMailDriver(env));
  const owner = await bootQueueApplication();
  const dependencies = owner.context.dependencies;
  return {
    container: dependencies.container,
    dependencies,
    mailer: () => scopedMailer,
    storage: () => dependencies.storage,
    application: owner.application,
    invoke: owner.context.invoke,
    stop: () => owner.context.dispose(),
  };
}

function assignTinkerGlobals(context: TinkerContext): void {
  Object.assign(globalThis, {
    container: context.container,
    dependencies: context.dependencies,
    application: context.application,
    invoke: context.invoke,
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

  // The REPL preload constructs and owns the application in the child process.
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
