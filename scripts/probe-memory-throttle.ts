/** Local, deterministic cardinality probe; this is not a production capacity claim. */
import { createMemoryThrottleMiddleware } from "../src/core/http/memoryThrottleMiddleware";
import { runWithRequestMeta } from "../src/core/http/requestMetaContext";

const middleware = createMemoryThrottleMiddleware({
  maxAttempts: 1,
  decaySeconds: 60,
  maxBuckets: 1024,
  pruneBatchSize: 16,
});
const next = async () => new Response("ok");
const samples: number[] = [];
let admitted = 0;
Bun.gc(true);
const heapBefore = process.memoryUsage().heapUsed;
for (let i = 0; i < 100_000; i++) {
  const started = performance.now();
  const response = await runWithRequestMeta(
    { ipAddress: `client-${i}`, userAgent: null, routeTemplate: "/items/:id" },
    () =>
      middleware(
        new Request(`http://example.test/items/${i}`, { headers: { accept: "application/json" } }),
        next,
      ),
  );
  admitted += response.status === 200 ? 1 : 0;
  if (i % 100 === 0) samples.push(performance.now() - started);
}
Bun.gc(true);
samples.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    requests: 100_000,
    admitted,
    ...middleware.stats(),
    heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    sampledP99Ms: samples[Math.floor(samples.length * 0.99)],
  }),
);
if (admitted !== 1024 || middleware.stats().retainedBuckets !== 1024)
  throw new Error("Cardinality budget failed.");
middleware.dispose();
if (middleware.stats().retainedBuckets !== 0) throw new Error("Disposal failed.");
