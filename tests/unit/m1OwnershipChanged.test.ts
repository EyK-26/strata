import { expect, test } from "bun:test";
import { runM1LifecycleProbe } from "../fixtures/m1LifecycleProbe";

test("isolated lifecycle boundary: ownership-change", async () => {
  const receipt = await runM1LifecycleProbe("ownership-change");
  expect(receipt.mode).toBe("ownership-change");
  expect(receipt.retryBlocked).toBe(true);
  expect(receipt.originalCauseRetained).toBe(true);
  expect(receipt.foreignMetadataPreserved).toBe(true);
});
