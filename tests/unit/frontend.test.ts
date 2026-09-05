import { afterEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_SPA_PREFIX,
  FRONTEND_MODE_PATTERN,
  FRONTEND_MODES,
  isSpaEnabled,
  isSpaMode,
  isViewsEnabled,
  isViewsMode,
  normalizeSpaPrefix,
  parseFrontendMode,
  readFrontendMode,
  readSpaPrefix,
} from "../../src/config/frontend";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("frontend mode", () => {
  const previousMode = process.env.FRONTEND_MODE;
  const previousPrefix = process.env.SPA_PREFIX;

  afterEach(() => {
    if (previousMode === undefined) {
      delete process.env.FRONTEND_MODE;
    } else {
      restoreEnvVar("FRONTEND_MODE", previousMode);
    }
    if (previousPrefix === undefined) {
      delete process.env.SPA_PREFIX;
    } else {
      restoreEnvVar("SPA_PREFIX", previousPrefix);
    }
  });

  test("defaults to api mode", () => {
    delete process.env.FRONTEND_MODE;

    expect(readFrontendMode()).toBe("api");
    expect(isViewsEnabled()).toBe(false);
    expect(isSpaEnabled()).toBe(false);
  });

  test("enables views for server-htmx mode", () => {
    process.env.FRONTEND_MODE = "server-htmx";

    expect(readFrontendMode()).toBe("server-htmx");
    expect(isViewsEnabled()).toBe(true);
    expect(isSpaEnabled()).toBe(false);
  });

  test("enables spa mode for spa-react", () => {
    process.env.FRONTEND_MODE = "spa-react";

    expect(readFrontendMode()).toBe("spa-react");
    expect(isSpaEnabled()).toBe(true);
    expect(isViewsEnabled()).toBe(false);
  });

  test("enables views and spa together in hybrid mode", () => {
    process.env.FRONTEND_MODE = "hybrid";

    expect(readFrontendMode()).toBe("hybrid");
    expect(isViewsEnabled()).toBe(true);
    expect(isSpaEnabled()).toBe(true);
  });

  test("parseFrontendMode is the single allowed-value list", () => {
    expect(parseFrontendMode("hybrid")).toBe("hybrid");
    expect(parseFrontendMode(" unknown ")).toBe("api");
    expect(parseFrontendMode(undefined)).toBe("api");
    expect(isViewsMode("hybrid")).toBe(true);
    expect(isSpaMode("hybrid")).toBe(true);
    expect(isViewsMode("api")).toBe(false);
    expect(isSpaMode("api")).toBe(false);
    expect(FRONTEND_MODES).toContain("hybrid");
    expect(FRONTEND_MODE_PATTERN.test("hybrid")).toBe(true);
    expect(FRONTEND_MODE_PATTERN.test("spa-react")).toBe(true);
    expect(FRONTEND_MODE_PATTERN.test("garbage")).toBe(false);
  });

  test("readSpaPrefix defaults to /app and normalizes values", () => {
    delete process.env.SPA_PREFIX;
    expect(readSpaPrefix()).toBe(DEFAULT_SPA_PREFIX);
    expect(normalizeSpaPrefix("apply")).toBe("/apply");
    expect(normalizeSpaPrefix("/apply/")).toBe("/apply");
    expect(normalizeSpaPrefix("/")).toBe("/app");
    expect(normalizeSpaPrefix("   ")).toBe("/app");
    process.env.SPA_PREFIX = "/portal/";
    expect(readSpaPrefix()).toBe("/portal");
  });
});
