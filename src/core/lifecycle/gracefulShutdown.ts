type ShutdownHandler = () => void | Promise<void>;

const shutdownHandlers = new Map<string, ShutdownHandler>();
let shutdownInstalled = false;
let shuttingDown = false;

function registerShutdownHandler(name: string, handler: ShutdownHandler): () => void {
  shutdownHandlers.set(name, handler);

  return () => {
    shutdownHandlers.delete(name);
  };
}

async function runGracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[shutdown] Received ${signal}, draining ${shutdownHandlers.size} handler(s)...`);

  for (const [name, handler] of shutdownHandlers) {
    try {
      await handler();
      console.log(`[shutdown] Completed ${name}`);
    } catch (error) {
      console.error(`[shutdown] Failed ${name}:`, error);
    }
  }
}

function installGracefulShutdownSignals(signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"]): void {
  if (shutdownInstalled) {
    return;
  }

  shutdownInstalled = true;

  for (const signal of signals) {
    process.on(signal, () => {
      void runGracefulShutdown(signal).finally(() => {
        process.exit(0);
      });
    });
  }
}

function resetGracefulShutdownForTests(): void {
  shutdownHandlers.clear();
  shutdownInstalled = false;
  shuttingDown = false;
}

export {
  installGracefulShutdownSignals,
  registerShutdownHandler,
  resetGracefulShutdownForTests,
  runGracefulShutdown,
};
