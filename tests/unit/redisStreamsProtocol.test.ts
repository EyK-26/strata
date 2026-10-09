import { describe, expect, test } from "bun:test";
import {
  ensureStreamGroup,
  readStreamEntry,
  reserveStreamJob,
} from "../../src/core/queue/redisStreams";

function replies(values: unknown[]) {
  return {
    send: async () => {
      if (!values.length) throw new Error("Unexpected protocol call");
      return values.shift();
    },
  };
}

describe("Streams protocol boundaries", () => {
  test("rejects invalid entry framing and retains missing payloads for quarantine", () => {
    for (const value of [null, [], [1, []], ["1-0", null]])
      expect(() => readStreamEntry(value, "owner")).toThrow("Invalid Redis stream entry");
    expect(readStreamEntry(["1-0", ["other", "field"]], "owner")).toEqual({
      id: "1-0",
      owner: "owner",
      payload: "",
    });
    expect(readStreamEntry(["1-0", ["payload", 3]], "owner")?.payload).toBe("");
  });
  test("rejects invalid claim and read replies instead of treating corruption as an empty queue", async () => {
    for (const value of [null, [], [1, []], ["0-0", null]])
      await expect(reserveStreamJob(replies([value]) as never, "key", "owner")).rejects.toThrow(
        "XAUTOCLAIM response",
      );
    for (const value of [{}, [], [[]], [["key", null]]])
      await expect(
        reserveStreamJob(replies([["0-0", []], value]) as never, "key", "owner"),
      ).rejects.toThrow("XREADGROUP response");
    expect(await reserveStreamJob(replies([["10-0", []], null]) as never, "key", "owner")).toEqual({
      reservation: null,
      cursor: "10-0",
    });
    expect(
      await reserveStreamJob(
        replies([["0-0", []], [["key", [["1-0", ["payload", "{}"]]]]]]) as never,
        "key",
        "owner",
      ),
    ).toEqual({ cursor: "0-0", reservation: { id: "1-0", owner: "owner", payload: "{}" } });
  });
  test("only BUSYGROUP is accepted during concurrent group initialization", async () => {
    let calls = 0;
    const busy = {
      send: async () => {
        if (++calls === 2) throw new Error("BUSYGROUP group exists");
        return 1;
      },
    };
    await expect(ensureStreamGroup(busy as never, "key")).resolves.toBeUndefined();
    const fail = {
      send: async () => {
        throw new Error("Connection unavailable");
      },
    };
    await expect(ensureStreamGroup(fail as never, "key")).rejects.toThrow("Connection unavailable");
    calls = 0;
    const createFail = {
      send: async () => {
        if (++calls === 2) throw new Error("WRONGTYPE stream");
        return 1;
      },
    };
    await expect(ensureStreamGroup(createFail as never, "key")).rejects.toThrow("WRONGTYPE");
  });
});
