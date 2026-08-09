import { join } from "node:path";
import { createAppDependencies } from "../../bootstrap/dependencies";
import { mailer } from "../../core/mail/mailer";
import { storage } from "../../core/storage/storage";
import { commentRepositoryToken } from "../../modules/comment/provider";
import { organizationRepositoryToken } from "../../modules/organization/provider";
import { projectRepositoryToken } from "../../modules/project/provider";
import { taskRepositoryToken } from "../../modules/task/provider";
import { userRepositoryToken } from "../../modules/user/provider";

const REPOSITORY_TOKENS = {
  users: userRepositoryToken,
  organizations: organizationRepositoryToken,
  projects: projectRepositoryToken,
  tasks: taskRepositoryToken,
  comments: commentRepositoryToken,
} as const;

type RepositoryName = keyof typeof REPOSITORY_TOKENS;

interface TinkerContext {
  container: ReturnType<typeof createAppDependencies>["container"];
  dependencies: ReturnType<typeof createAppDependencies>;
  repos: Record<RepositoryName, () => unknown>;
  mailer: typeof mailer;
  storage: typeof storage;
}

function createTinkerContext(): TinkerContext {
  const dependencies = createAppDependencies();
  const { container } = dependencies;

  const repos = Object.fromEntries(
    Object.entries(REPOSITORY_TOKENS).map(([name, token]) => [
      name,
      () => container.resolve(token),
    ]),
  ) as Record<RepositoryName, () => unknown>;

  return {
    container,
    dependencies,
    repos,
    mailer,
    storage,
  };
}

function assignTinkerGlobals(context: TinkerContext): void {
  Object.assign(globalThis, {
    container: context.container,
    dependencies: context.dependencies,
    repos: context.repos,
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
      WORKHUB_TINKER: "1",
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

export type { RepositoryName, TinkerContext };
export { assignTinkerGlobals, createTinkerContext, REPOSITORY_TOKENS, tinkerCommand };
