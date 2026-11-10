import { createServiceToken } from "@getstrata/core/contracts/token";
import type { ExecutionContext } from "./application";

/** Canonical implicit execution dependency; applications cannot declare or override it. */
const CORE_EXECUTION_CONTEXT_TOKEN = createServiceToken<ExecutionContext>("core.execution.context");

export type {
  ExecutionActor,
  ExecutionContext,
  ExecutionEnvelope,
  ExecutionTaskOutcome,
} from "./application";
export { CORE_EXECUTION_CONTEXT_TOKEN };
