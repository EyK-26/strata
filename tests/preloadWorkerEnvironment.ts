import { readFileSync } from "node:fs";
import { testWorkerEnvironment } from "./helpers/testWorkerEnvironment";

// Runs before either existing preload imports any SQL/cache modules. Bun isolates JavaScript;
// these explicit worker URLs isolate the external services those modules will connect to.
const file = process.env.STRATA_TEST_WORKER_ENV_FILE;
if (file) {
  const data: unknown = JSON.parse(readFileSync(file, "utf8"));
  Object.assign(process.env, testWorkerEnvironment(data, process.env.BUN_TEST_WORKER_ID ?? "1"));
}
