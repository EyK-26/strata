import { expect, test } from "bun:test";
import { runM1LifecycleProbe } from "../fixtures/m1LifecycleProbe";

test("isolated lifecycle boundary: provider-rejection", async () => {
  const receipt = await runM1LifecycleProbe("provider-rejection");
  expect(receipt.mode).toBe("provider-rejection");
  expect(receipt.retryBlocked).toBe(true);
  expect(receipt.originalCauseRetained).toBe(true);
  expect(receipt.foreignMetadataPreserved).toBe(true);
});
