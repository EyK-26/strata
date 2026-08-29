import { describe, expect, test } from "bun:test";
import { dispatchModelWebhook } from "../../src/listeners/dispatchWebhooks";

describe("dispatchModelWebhook", () => {
  test("swallows dispatch failures so model writes can finish", async () => {
    await expect(
      dispatchModelWebhook("organization", "created", { id: 1 }),
    ).resolves.toBeUndefined();
  });
});
