import {
  type Application,
  type CompletionResult,
  createApplication,
  type ProviderScope,
  type StopResult,
} from "@getstrata/core/runtime/application";
import type { StrataAppConfig } from "./types.ts";

type ParentSignal = "SIGINT" | "SIGTERM";

interface NativeChild {
  readonly exited: Promise<number>;
  readonly exitCode: number | null;
  kill(signal: ParentSignal): void;
}

interface NativeSpawnOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdin: "inherit";
  readonly stdout: "inherit";
  readonly stderr: "inherit";
}

type NativeSpawn = (argv: readonly string[], options: NativeSpawnOptions) => NativeChild;

interface SignalHost {
  on(signal: ParentSignal, callback: () => void): void;
  off(signal: ParentSignal, callback: () => void): void;
}

/** Private native boundary for deterministic adapter tests; not a public CLI option. */
interface NativeHost {
  readonly spawn?: NativeSpawn;
  readonly signals?: SignalHost;
  readonly shutdownTimeoutMs?: number;
}

interface BunChildSupervisor {
  readonly application: Application;
  /** Starts once; all calls share this operation's result promise. */
  run(): Promise<number>;
}

interface PrimaryFailure {
  /** A wrapper records presence even when the original thrown value is undefined. */
  readonly error: unknown;
}

class ChildSupervisorError extends Error {
  /** Original delivery and owned-listener teardown faults, separate from owner diagnostics. */
  readonly relayErrors: readonly unknown[];

  constructor(
    readonly childExitCode: number | null,
    readonly primary: PrimaryFailure | undefined,
    relayErrors: readonly unknown[],
    readonly stop: StopResult,
    readonly completion: Promise<CompletionResult>,
  ) {
    const cause = primary
      ? primary.error
      : relayErrors.length > 0
        ? relayErrors[0]
        : stop.snapshot.errors[0]?.error;
    super("Child supervision failed.", { cause });
    this.name = "ChildSupervisorError";
    this.relayErrors = Object.freeze([...relayErrors]);
  }
}

type Relay = { signal: ParentSignal; callback: () => void };

function bunExecutable(): string {
  return process.execPath.includes("bun") ? process.execPath : "bun";
}

/** Keep the original rejection observable without changing its value or result. */
function observe<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => {});
  return promise;
}

/**
 * Private CLI composition: construction has no native effects. run starts ownership.
 * Child-only first-signal startup cancellation still waits for the already owned child;
 * clean supervision returns its actual code. Genuine startup/work failures stay distinct.
 */
function createBunChildSupervisor(
  app: Pick<StrataAppConfig, "root">,
  bunArgs: readonly string[],
  host: NativeHost = {},
): BunChildSupervisor {
  const argv = Object.freeze([bunExecutable(), ...bunArgs]);
  const options: NativeSpawnOptions = Object.freeze({
    cwd: app.root,
    env: Object.freeze({ ...process.env }),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const spawn: NativeSpawn = host.spawn ?? ((args, config) => Bun.spawn([...args], config));
  const signals: SignalHost = host.signals ?? {
    on: (signal, callback) => {
      process.on(signal, callback);
    },
    off: (signal, callback) => {
      process.off(signal, callback);
    },
  };
  const relayErrors: unknown[] = [];
  let child: NativeChild | undefined;
  let exited: Promise<number> | undefined;
  let childExitCode: number | null = null;
  let startupSignal: AbortSignal | undefined;
  let firstSignal: ParentSignal | undefined;
  let running: Promise<number> | undefined;
  let startupPrimary: PrimaryFailure | undefined;

  const waitForExit = (owned: NativeChild): Promise<number> => {
    // Reserve the observation before a native getter/thenable or reentrant callback runs.
    exited ??= observe(
      Promise.resolve()
        .then(() => owned.exited)
        .then((code) => {
          childExitCode = code;
          return code;
        }),
    );
    return exited;
  };
  const removeRelays = (relays: readonly Relay[]): unknown[] => {
    const errors: unknown[] = [];
    for (const relay of [...relays].reverse()) {
      try {
        signals.off(relay.signal, relay.callback);
      } catch (error) {
        errors.push(error);
        relayErrors.push(error);
      }
    }
    return errors;
  };
  const setup = async (scope: ProviderScope): Promise<void> => {
    startupSignal = scope.signal;
    const owned = await scope.acquire<NativeChild>({
      name: "cli.child",
      open: () => {
        try {
          child = spawn(argv, options);
          return { ok: true, value: child };
        } catch (error) {
          startupPrimary = Object.freeze({ error });
          throw error;
        }
      },
      stop: async (resource, context) => {
        // Native status can settle before its promise observer. Drain still requires exited.
        if (childExitCode !== null || resource.exitCode !== null) return;
        try {
          resource.kill(context.reason === "SIGINT" ? "SIGINT" : "SIGTERM");
        } catch (error) {
          // Failed delivery is a transport fault. Only actual exit can acknowledge stop.
          relayErrors.push(error);
          await waitForExit(resource);
        }
      },
      drain: async (resource) => {
        await waitForExit(resource);
      },
      close: async (resource) => {
        await waitForExit(resource);
      },
    });
    waitForExit(owned);
    await scope.acquire<readonly Relay[]>({
      name: "cli.child.signals",
      open: () => {
        const relays: Relay[] = [];
        try {
          for (const signal of ["SIGINT", "SIGTERM"] as const) {
            const callback = () => {
              if (firstSignal !== undefined) return;
              firstSignal = signal;
              void application.stop({ reason: signal });
            };
            // on() may install and then throw. Its exact remover already exists.
            relays.push({ signal, callback });
            signals.on(signal, callback);
          }
          return { ok: true, value: relays };
        } catch (error) {
          startupPrimary = Object.freeze({ error });
          const cleanupErrors = removeRelays(relays);
          return {
            ok: false,
            error,
            disposition: cleanupErrors.length === 0 ? "cleaned" : "unknown",
            cleanupErrors,
          };
        }
      },
      close: (relays) => {
        const errors = removeRelays(relays);
        if (errors.length > 0) throw new AggregateError(errors, "Child signal cleanup failed.");
      },
    });
  };
  const application = createApplication({
    providers: [{ name: "cli.child-supervisor", setup }],
    shutdownTimeoutMs: host.shutdownTimeoutMs,
  });

  const execute = async (): Promise<number> => {
    let primary: PrimaryFailure | undefined;
    try {
      await application.start();
      const owned = child;
      if (owned) {
        // A signal can close admission just after start settles. Observe owned work;
        // do not try to admit a new command into an already stopping application.
        if (application.state.phase === "ready") await application.run(() => waitForExit(owned));
        else await waitForExit(owned);
      }
    } catch (error) {
      const signalOnlyCancellation =
        firstSignal !== undefined &&
        startupSignal?.aborted === true &&
        application.state.boot === "cancelled" &&
        error === startupSignal.reason;
      if (!signalOnlyCancellation) primary = startupPrimary ?? Object.freeze({ error });
    }
    if (child && childExitCode === null) {
      // Startup may have been cancelled after acquiring a child, before app.run could
      // be admitted. Its already-journaled native lifetime still must be observed.
      try {
        await waitForExit(child);
      } catch (error) {
        primary ??= Object.freeze({ error });
      }
    }
    const stop = await application.stop({ reason: "CHILD_FINISHED" });
    if (
      primary === undefined &&
      relayErrors.length === 0 &&
      stop.successful &&
      childExitCode !== null
    ) {
      return childExitCode;
    }
    if (primary !== undefined && relayErrors.length === 0 && stop.successful) throw primary.error;
    throw new ChildSupervisorError(
      childExitCode,
      primary,
      relayErrors,
      stop,
      application.completion,
    );
  };

  return Object.freeze({
    application,
    run(): Promise<number> {
      running ??= observe(Promise.resolve().then(execute));
      return running;
    },
  });
}

export type {
  BunChildSupervisor,
  NativeChild,
  NativeHost,
  NativeSpawn,
  NativeSpawnOptions,
  ParentSignal,
  PrimaryFailure,
  SignalHost,
};
export { bunExecutable, ChildSupervisorError, createBunChildSupervisor };
