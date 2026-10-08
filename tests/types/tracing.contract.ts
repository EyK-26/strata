/** Compiled against source and packed public exports; never executed. */
import { type ServiceProvider, tracingProvider } from "@getstrata/bootstrap";
import { createTracingRuntime, type TracingOptions, type TracingRuntime } from "@getstrata/core";
import { createTracingMiddleware } from "@getstrata/core/tracing/tracingMiddleware";

export async function tracingContracts(): Promise<void> {
  const options: TracingOptions = {
    sampleRatio: 0.1,
    maxQueueSize: 1024,
    exportTimeoutMillis: 3000,
  };
  const runtime: TracingRuntime = createTracingRuntime(options);
  const provider: ServiceProvider = tracingProvider;
  const response: Response = await createTracingMiddleware(runtime)(
    new Request("http://shop"),
    async () => new Response(),
  );
  const span = runtime.tracer.startSpan("business-operation");
  const identity: string = span.spanContext().traceId;
  span.end();
  await runtime.forceFlush();
  await runtime.shutdown();
  // @ts-expect-error Sampling ratios are numeric, never implicit string flags.
  createTracingRuntime({ sampleRatio: "0.1" });
  // @ts-expect-error Exporter implementations must satisfy the SDK ownership contract.
  createTracingRuntime({ exporter: {} });
  void [provider, response, identity];
}
