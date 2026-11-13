import { describe, expect, test } from "bun:test";
import { Policy, PolicyDeniedError, PolicyGate } from "@getstrata/core/auth/policy";

class LearnPolicy extends Policy {
  viewPremiumEpisode(user: { id: number } | null, record: { learn_subscriber: boolean } | null) {
    if (!user) return false;
    return record?.learn_subscriber === true;
  }
}

describe("PolicyGate", () => {
  test("supports custom policy action names beyond the base Policy methods", async () => {
    const gate = new PolicyGate<{ learn: LearnPolicy }>();
    gate.register("learn", new LearnPolicy());

    const user = { id: 1 };
    expect(
      await gate.allows("learn", "viewPremiumEpisode", user, { learn_subscriber: false }),
    ).toBe(false);
    expect(await gate.allows("learn", "viewPremiumEpisode", user, { learn_subscriber: true })).toBe(
      true,
    );
    expect(await gate.allows("learn", "viewPremiumEpisode", null, null)).toBe(false);
  });

  test("authorize throws when the policy denies access", async () => {
    const gate = new PolicyGate<{ learn: LearnPolicy }>();
    gate.register("learn", new LearnPolicy());

    await expect(
      gate.authorize("learn", "viewPremiumEpisode", null, { learn_subscriber: false }),
    ).rejects.toThrow(PolicyDeniedError);
  });

  test("ignores inherited action names on the Policy prototype", async () => {
    const gate = new PolicyGate<{ learn: LearnPolicy }>();
    gate.register("learn", new LearnPolicy());

    expect(await gate.allows("learn", "constructor" as "view", { id: 1 })).toBe(false);
    expect(await gate.allows("learn", "toString" as "view", { id: 1 })).toBe(false);
  });
});
