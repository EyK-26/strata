import { describe, expect, test } from "bun:test";
import { Policy, PolicyGate } from "../../src/core/auth/policy";
import { ForbiddenError } from "../../src/core/errors/http";

class LearnPolicy extends Policy {
  viewPremiumEpisode(user: { id: number } | null, record: { learn_subscriber: boolean } | null) {
    if (!user) return false;
    return record?.learn_subscriber === true;
  }
}

describe("PolicyGate", () => {
  test("supports custom policy action names beyond the base Policy methods", () => {
    const gate = new PolicyGate();
    gate.register("learn", new LearnPolicy());

    const user = { id: 1 };
    expect(gate.allows("learn", "viewPremiumEpisode", user, { learn_subscriber: false })).toBe(
      false,
    );
    expect(gate.allows("learn", "viewPremiumEpisode", user, { learn_subscriber: true })).toBe(true);
    expect(gate.allows("learn", "viewPremiumEpisode", null, null)).toBe(false);
  });

  test("authorize throws when the policy denies access", () => {
    const gate = new PolicyGate();
    gate.register("learn", new LearnPolicy());

    expect(() =>
      gate.authorize("learn", "viewPremiumEpisode", null, { learn_subscriber: false }),
    ).toThrow(ForbiddenError);
  });

  test("ignores inherited action names on the Policy prototype", () => {
    const gate = new PolicyGate();
    gate.register("learn", new LearnPolicy());

    expect(gate.allows("learn", "constructor", { id: 1 })).toBe(false);
    expect(gate.allows("learn", "toString", { id: 1 })).toBe(false);
  });
});
