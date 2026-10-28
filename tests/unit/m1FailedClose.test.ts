import { expect, test } from "bun:test";
import { runM1LifecycleProbe } from "../fixtures/m1LifecycleProbe";

test("isolated lifecycle boundary: failed-close", async () => {
  const receipt = await runM1LifecycleProbe("failed-close");
  expect(receipt.mode).toBe("failed-close");
  expect(receipt.retryBlocked).toBe(true);
  expect(receipt.originalCauseRetained).toBe(true);
  expect(receipt.foreignMetadataPreserved).toBe(true);
});
