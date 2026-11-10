import type { ServiceDeclaration } from "./services";
import type { ServiceToken } from "./token";

/** Plain configuration data is copied and frozen before any application work begins. */
type ApplicationConfigValue =
  | string
  | number
  | boolean
  | null
  | readonly ApplicationConfigValue[]
  | { readonly [key: string]: ApplicationConfigValue };
type ApplicationConfig = Readonly<Record<string, ApplicationConfigValue>>;

type ApplicationPhase = "constructed" | "starting" | "ready" | "stopping" | "stopped" | "failed";
type BootDisposition = "not-started" | "pending" | "ready" | "failed" | "cancelled";
type CleanupDisposition = "not-required" | "open" | "pending" | "clean" | "failed";
type ResourcePhase = "stop" | "drain" | "flush" | "close";

interface ApplicationDiagnostic {
  readonly code: string;
  readonly kind: "startup" | "acquisition" | "cleanup";
  readonly provider?: string;
  readonly resource?: string;
  readonly phase?: ResourcePhase;
  /** Opaque caller-owned payload: never inspected, serialized or frozen by the owner. */
  readonly error: unknown;
}

interface ApplicationSnapshot {
  readonly phase: ApplicationPhase;
  readonly boot: BootDisposition;
  readonly cleanup: CleanupDisposition;
  readonly pendingAcquisitions: readonly string[];
  /** Includes settled unknown acquisitions for which no handle was returned. */
  readonly retainedResources: readonly string[];
  readonly errors: readonly ApplicationDiagnostic[];
}

interface StopResult {
  /** True only when cleanup is confirmed clean, regardless of the boot outcome. */
  readonly successful: boolean;
  readonly timedOut: boolean;
  readonly snapshot: ApplicationSnapshot;
}

/** Actual settlement of owned work; it may report failed cleanup with retained ownership. */
type CompletionResult = StopResult;

interface CleanupContext {
  readonly signal: AbortSignal;
  readonly reason: string;
}

/**
 * Adapter outcome records use own data fields, including ok/value or error/disposition.
 * Accessor or malformed outcomes become unknown acquisition failures without invoking getters.
 */
type OpenOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: unknown;
      readonly disposition: "not-acquired" | "cleaned" | "unknown";
      readonly cleanupErrors?: readonly unknown[];
    };

/**
 * A declaration record with own data fields: name/open/close and any optional hooks.
 * Accessors and inherited prototype methods are rejected before open is invoked.
 * Class adapters can supply own arrow functions or an explicit declaration record.
 */
interface ResourceSpec<T> {
  readonly name: string;
  /** A raw throw/rejection always means unknown disposal, without inspecting its payload. */
  readonly open: (signal: AbortSignal) => OpenOutcome<T> | Promise<OpenOutcome<T>>;
  readonly close: (value: T, context: CleanupContext) => void | Promise<void>;
  readonly stop?: (value: T, context: CleanupContext) => void | Promise<void>;
  readonly drain?: (value: T, context: CleanupContext) => void | Promise<void>;
  readonly flush?: (value: T, context: CleanupContext) => void | Promise<void>;
}

interface ProviderScope {
  readonly applicationId: string;
  readonly config: ApplicationConfig;
  readonly signal: AbortSignal;
  resolve<T>(token: ServiceToken<T>): T;
  acquire<T>(spec: ResourceSpec<T>): Promise<T>;
}

interface ProviderDefinition {
  readonly name: string;
  readonly requires?: readonly string[];
  readonly setup: (scope: ProviderScope) => void | Promise<void>;
}

/** Uses the same owner as providers and starts after all providers have finished setup. */
type TransportDefinition = ProviderDefinition;

interface ApplicationDefinition {
  readonly config?: ApplicationConfig;
  readonly providers: readonly ProviderDefinition[];
  readonly transports?: readonly TransportDefinition[];
  readonly services?: readonly ServiceDeclaration[];
  readonly overrides?: readonly ServiceDeclaration[];
  readonly shutdownTimeoutMs?: number;
  readonly startupCleanupTimeoutMs?: number;
}

type ExecutionActor =
  | { readonly kind: "principal"; readonly claims: ApplicationConfig }
  | { readonly kind: "system"; readonly policy: string };

interface ExecutionEnvelopeFields {
  readonly externalId?: string;
  readonly metadata?: ApplicationConfig;
  readonly tenant?: ApplicationConfig;
  readonly signal?: AbortSignal;
  readonly deadlineAtMs?: number;
}

type ExecutionEnvelope = ExecutionEnvelopeFields &
  (
    | { readonly kind: "request" | "command"; readonly actor?: ExecutionActor }
    | { readonly kind: "job"; readonly actor: ExecutionActor }
  );

type ExecutionContext = ExecutionEnvelope & {
  readonly applicationId: string;
  readonly executionId: string;
  readonly metadata: ApplicationConfig;
  readonly signal: AbortSignal;
};

/** A child observation settles after its body and all admitted descendants. */
type ExecutionTaskOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

interface CommandScope {
  readonly context: ExecutionContext;
  readonly applicationId: string;
  readonly config: ApplicationConfig;
  readonly signal: AbortSignal;
  /** Composition-only access; expires with this admitted callback, not an execution resource scope. */
  resolve<T>(token: ServiceToken<T>): T;
  /** Joined resource-free work in this execution; observation does not recover failures. */
  readonly spawn: <T>(
    work: (scope: CommandScope) => T | Promise<T>,
  ) => Promise<ExecutionTaskOutcome<T>>;
}

interface Application {
  readonly id: string;
  readonly state: ApplicationSnapshot;
  /** Shared while starting/ready; new calls once stopping begins get a cached terminal rejection. */
  start(): Promise<void>;
  /** Cached bounded observation. Timeout never releases the owner's resource obligations. */
  stop(options?: { readonly reason?: string }): Promise<StopResult>;
  /** Stable, never rejecting; remains pending while owned operations are actually still running. */
  readonly completion: Promise<CompletionResult>;
  run<T>(work: (scope: CommandScope) => T | Promise<T>): Promise<T>;
  run<T>(envelope: ExecutionEnvelope, work: (scope: CommandScope) => T | Promise<T>): Promise<T>;
}

export type {
  Application,
  ApplicationConfig,
  ApplicationConfigValue,
  ApplicationDefinition,
  ApplicationDiagnostic,
  ApplicationPhase,
  ApplicationSnapshot,
  BootDisposition,
  CleanupContext,
  CleanupDisposition,
  CommandScope,
  CompletionResult,
  ExecutionActor,
  ExecutionContext,
  ExecutionEnvelope,
  ExecutionTaskOutcome,
  OpenOutcome,
  ProviderDefinition,
  ProviderScope,
  ResourcePhase,
  ResourceSpec,
  StopResult,
  TransportDefinition,
};
