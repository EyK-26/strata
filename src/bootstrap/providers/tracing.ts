import { CORE_TRACING_RUNTIME_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import {
  captureTracingOptions,
  createTracingRuntime,
  type TracingOptions,
} from "@getstrata/core/tracing/tracingMiddleware";
import type { ServiceProvider } from "../contracts";

/** Capture app configuration now; acquire telemetry only when its context starts. */
function createTracingProvider(options: TracingOptions = {}): ServiceProvider {
  const configured = captureTracingOptions(options);
  let registered = false;
  return {
    name: "core.tracing",
    register({ container, onCleanup }) {
      if (registered)
        throw new Error(
          "A tracing provider belongs to one application context; create a new provider for each context.",
        );
      registered = true;
      const runtime = createTracingRuntime(configured);
      onCleanup(() => runtime.shutdown(), "close");
      onCleanup(() => runtime.forceFlush(), "flush");
      container.set(CORE_TRACING_RUNTIME_TOKEN, runtime);
    },
  };
}

export { createTracingProvider };
