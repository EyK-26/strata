import { afterEach, describe, expect, test } from "bun:test";
import {
  FRONTEND_MODE_PATTERN,
  FRONTEND_MODES,
  isSpaEnabled,
  isSpaMode,
  isViewsEnabled,
  isViewsMode,
  parseFrontendMode,
  readFrontendMode,
} from "../../src/config/frontend";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("frontend mode", () => {
  const previousMode = process.env.FRONTEND_MODE;

  afterEach(() => {
    if (previousMode === undefined) {
      delete process.env.FRONTEND_MODE;
    } else {
      restoreEnvVar("FRONTEND_MODE", previousMode);
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
});
