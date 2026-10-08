import { acquireTracingRuntime } from "@getstrata/core/tracing/tracingMiddleware";
import type { ServiceProvider } from "../contracts";

const tracingProvider: ServiceProvider = {
  name: "core.tracing",
  register({ onCleanup }) {
    const ownership = acquireTracingRuntime();
    onCleanup(() => ownership.flush(), "flush");
    onCleanup(() => ownership.release(), "close");
  },
};
export default tracingProvider;
