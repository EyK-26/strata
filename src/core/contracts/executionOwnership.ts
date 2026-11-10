import { createServiceToken } from "@getstrata/core/contracts/token";
import type { ResourceSpec } from "./application";
import type { NonPromisePayload } from "./services";

/** Internal synchronous context installation around the complete leased invocation. */
type OwnedInvocation = <R>(invoke: () => R) => R;

/** Internal immutable observation; errors remain opaque caller-owned payloads. */
interface Joined<T> {
  readonly invoked: boolean;
  readonly body: Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: unknown }>;
  readonly strictFailed: boolean;
  readonly retained: boolean;
  /** Inspection only: these occurrences are already joined by the parent tree. */
  readonly strict: readonly Readonly<{ error: unknown }>[];
}

/** Internal authority for one actual node; never supplied to public operation work. */
interface OwnedBoundary {
  readonly acquire: <T>(spec: ResourceSpec<T> & NonPromisePayload<T>) => Promise<T>;
  /** Validate the current live body is this boundary or one of its actual descendants. */
  readonly assertWithin: () => void;
  /** Restore this exact live direct body for a native continuation, without reviving it. */
  readonly bindNative: <A extends readonly unknown[], R>(
    work: (...args: A) => Promise<R>,
  ) => (...args: A) => Promise<R>;
}

/** Internal execution-bound dispatch through the existing task launcher and journal. */
interface OwnedExecution {
  readonly joined: <T>(
    work: (task: OwnedBoundary) => T | Promise<T>,
    enter?: OwnedInvocation,
  ) => Promise<Joined<T>>;
}

const CORE_EXECUTION_OWNERSHIP_TOKEN = createServiceToken<OwnedExecution>(
  "core.execution.ownership",
);

export type { Joined, OwnedBoundary, OwnedExecution, OwnedInvocation };
export { CORE_EXECUTION_OWNERSHIP_TOKEN };
