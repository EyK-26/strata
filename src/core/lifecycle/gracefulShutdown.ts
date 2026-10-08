type ShutdownPhase = "stop" | "drain" | "flush" | "close" | "force";
type ShutdownContext = { signal: AbortSignal; reason: string };
type ShutdownHandler = (context: ShutdownContext) => void | Promise<void>;
type ShutdownFailure = { name: string; phase: ShutdownPhase; error: unknown };
type ShutdownResult = { successful: boolean; timedOut: boolean; errors: ShutdownFailure[] };
type Registration = { name: string; phase: ShutdownPhase; handler: ShutdownHandler };

function resolveShutdownTimeoutMs(): number {
  const configured = process.env.SHUTDOWN_TIMEOUT_MS;
  const value = configured === undefined ? 30_000 : Number(configured);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647)
    throw new RangeError("SHUTDOWN_TIMEOUT_MS must be an integer between 1 and 2147483647.");
  return value;
}

class LifecycleCoordinator {
  private readonly handlers = new Map<string, Registration>();
  private running?: Promise<ShutdownResult>;
  private readonly timeoutMs: number;

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? resolveShutdownTimeoutMs();
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs <= 0 ||
      this.timeoutMs > 2_147_483_647
    )
      throw new RangeError("Shutdown timeout must be an integer between 1 and 2147483647.");
  }

  get isShuttingDown(): boolean {
    return this.running !== undefined;
  }

  register(name: string, handler: ShutdownHandler, phase: ShutdownPhase = "close"): () => void {
    if (this.isShuttingDown) throw new Error("Cannot register resources during shutdown.");
    if (!["stop", "drain", "flush", "close", "force"].includes(phase))
      throw new TypeError("Unknown shutdown phase.");
    const registration = { name, handler, phase };
    this.handlers.set(name, registration);
    return () => {
      if (this.handlers.get(name) === registration) this.handlers.delete(name);
    };
  }

  shutdown(reason = "MANUAL"): Promise<ShutdownResult> {
    if (this.running) return this.running;
    // Defer execution until running is assigned, including reentrant callbacks.
    this.running = Promise.resolve().then(() => this.execute(reason));
    return this.running;
  }

  private async execute(reason: string): Promise<ShutdownResult> {
    const registrations = [...this.handlers.values()];
    const controller = new AbortController();
    const context = { signal: controller.signal, reason };
    const errors: ShutdownFailure[] = [];
    let timedOut = false;
    let forced = false;
    const record = (entry: Registration, error: unknown) => {
      errors.push({ name: entry.name, phase: entry.phase, error });
      console.error(`[shutdown] Failed ${entry.phase}:${entry.name}:`, error);
    };
    const force = () => {
      if (forced) return;
      forced = true;
      for (const entry of registrations.filter((entry) => entry.phase === "force")) {
        try {
          void Promise.resolve(entry.handler(context)).catch((error) => record(entry, error));
        } catch (error) {
          record(entry, error);
        }
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        const error = new Error(`Shutdown deadline exceeded after ${this.timeoutMs}ms.`);
        errors.push({ name: "deadline", phase: "force", error });
        controller.abort(error);
        force();
        resolve();
      }, this.timeoutMs);
    });
    const sequence = (async () => {
      let unsafeToClose = false;
      for (const phase of ["stop", "drain", "flush", "close"] as const) {
        if (controller.signal.aborted) return;
        if (unsafeToClose && (phase === "flush" || phase === "close")) {
          controller.abort(new Error("Admission or drain failed; infrastructure remains open."));
          force();
          return;
        }
        for (const entry of registrations.filter((entry) => entry.phase === phase)) {
          if (controller.signal.aborted) return;
          try {
            await entry.handler(context);
          } catch (error) {
            record(entry, error);
            if (phase === "stop" || phase === "drain") unsafeToClose = true;
          }
        }
      }
    })();
    try {
      await Promise.race([sequence, deadline]);
    } finally {
      clearTimeout(timer);
      this.handlers.clear();
    }
    return { successful: errors.length === 0 && !timedOut, timedOut, errors: [...errors] };
  }
}

let defaultLifecycle = new LifecycleCoordinator();
const installations = new Map<LifecycleCoordinator, () => void>();

function registerShutdownHandler(
  name: string,
  handler: ShutdownHandler,
  phase: ShutdownPhase = "close",
): () => void {
  return defaultLifecycle.register(name, handler, phase);
}
function runGracefulShutdown(signal: string): Promise<ShutdownResult> {
  return defaultLifecycle.shutdown(signal);
}
function installGracefulShutdownSignals(
  signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"],
  lifecycle: LifecycleCoordinator = defaultLifecycle,
): () => void {
  const existing = installations.get(lifecycle);
  if (existing) return existing;
  let exiting = false;
  const handler = (signal: string) => {
    if (exiting) return;
    exiting = true;
    void lifecycle.shutdown(signal).then(
      (result) => process.exit(result.successful ? 0 : 1),
      (error) => {
        console.error("[shutdown] Coordinator failed:", error);
        process.exit(1);
      },
    );
  };
  const callbacks = signals.map((signal) => {
    const callback = () => handler(signal);
    process.on(signal, callback);
    return () => process.off(signal, callback);
  });
  const uninstall = () => {
    for (const remove of callbacks) remove();
    if (installations.get(lifecycle) === uninstall) installations.delete(lifecycle);
  };
  installations.set(lifecycle, uninstall);
  return uninstall;
}
function resetGracefulShutdownForTests(): void {
  for (const remove of [...installations.values()]) remove();
  defaultLifecycle = new LifecycleCoordinator();
}

export type { ShutdownContext, ShutdownFailure, ShutdownHandler, ShutdownPhase, ShutdownResult };
export {
  installGracefulShutdownSignals,
  LifecycleCoordinator,
  registerShutdownHandler,
  resetGracefulShutdownForTests,
  runGracefulShutdown,
};
