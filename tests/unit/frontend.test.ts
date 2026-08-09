import { afterEach, describe, expect, test } from "bun:test";
import { isSpaEnabled, isViewsEnabled, readFrontendMode } from "../../src/config/frontend";

describe("frontend mode", () => {
  const previousMode = process.env.FRONTEND_MODE;

  afterEach(() => {
    if (previousMode === undefined) {
      delete process.env.FRONTEND_MODE;
    } else {
      process.env.FRONTEND_MODE = previousMode;
    }
  });

  test("defaults to api mode", () => {
    delete process.env.FRONTEND_MODE;

    expect(readFrontendMode()).toBe("api");
    expect(isViewsEnabled()).toBe(false);
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
});
