import { describe, expect, test } from "bun:test";
import { getRouteParams, type RouteRequest } from "../../src/core/http/route";

describe("getRouteParams", () => {
  test("returns typed route params from the request", () => {
    const request = new Request("http://example.test/projects/42") as RouteRequest<{ id: string }>;
    request.params = { id: "42" };

    expect(getRouteParams(request)).toEqual({ id: "42" });
  });
});
