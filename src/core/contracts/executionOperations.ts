import { createServiceToken } from "@getstrata/core/contracts/token";

/** Execution-bound admission to the current active callback's owned task tree. */
interface ExecutionOperations {
  readonly assertActive: () => void;
  /** Observe the actual body result while its complete owned subtree stays joined. */
  readonly operation: <T>(work: () => T | Promise<T>) => Promise<T>;
}

/** Canonical implicit execution dependency; applications cannot declare or override it. */
const CORE_EXECUTION_OPERATIONS_TOKEN = createServiceToken<ExecutionOperations>(
  "core.execution.operations",
);

export type { ExecutionOperations };
export { CORE_EXECUTION_OPERATIONS_TOKEN };
