import { expect, test } from "bun:test";
import { verifyHttpMailExtension, verifyMailDelegation } from "../helpers/mailDriverContract";

test("Mailer delegates the complete existing extension contract and propagates failures", async () => {
  expect(await verifyMailDelegation()).toEqual({ mailDelegation: true, errorIdentity: true });
});

test("an injected HTTP provider owns idempotency, caller cancellation and whole-send deadlines", async () => {
  expect(await verifyHttpMailExtension()).toEqual({
    httpMailExtension: true,
    providerIdempotency: true,
    callerCancellation: true,
    wholeSendDeadline: true,
  });
});
