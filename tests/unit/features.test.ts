import { afterEach, describe, expect, test } from "bun:test";
import { featureFlags, isFeatureEnabled } from "../../src/config/features";

const envKeys = ["FEATURE_AUDIT_LOG", "FEATURE_WEBHOOKS", "FEATURE_SEARCH"] as const;

const previousValues = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of envKeys) {
    const previous = previousValues[key];

    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
});

describe("feature flags", () => {
  test("disables optional modules when FEATURE_* is false", () => {
    process.env.FEATURE_AUDIT_LOG = "false";
    process.env.FEATURE_WEBHOOKS = "false";
    process.env.FEATURE_SEARCH = "false";

    expect(isFeatureEnabled("auditLog")).toBe(false);
    expect(isFeatureEnabled("webhooks")).toBe(false);
    expect(isFeatureEnabled("fullTextSearch")).toBe(false);
  });

  test("exports current flag snapshot", () => {
    expect(typeof featureFlags.oauthLogin).toBe("boolean");
    expect(typeof featureFlags.scim).toBe("boolean");
    expect(typeof featureFlags.siemExport).toBe("boolean");
  });
});
