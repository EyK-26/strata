import { describe, expect, test } from "bun:test";
import {
  ensureStreamGroup,
  readStreamEntry,
  readStreamTime,
  reserveStreamJob,
  scheduleStreamRetry,
  watchStreamDeadline,
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
  test("deadline clock rejects malformed Redis replies", async () => {
    for (const value of [
      null,
      [],
      [null, "0"],
      ["1", null],
      ["", "0"],
      ["1", "bad"],
      ["bad", "0"],
      ["-1", "0"],
      ["1", "1000000"],
      ["1", "-1"],
      ["1.5", "0"],
      [String(Number.MAX_SAFE_INTEGER), "0"],
    ])
      await expect(readStreamTime(replies([value]) as never)).rejects.toThrow("TIME response");
    expect(await readStreamTime(replies([["10", "250000"]]) as never)).toBe(10250);
  });
  test("deadline watch rechecks the clock and propagates infrastructure failures", async () => {
    let expired = false;
    const clock = replies([
      ["0", "1000"],
      ["1", "0"],
    ]);
    const stop = watchStreamDeadline(
      clock as never,
      10,
      1,
      () => {
        expired = true;
      },
      () => {
        throw new Error("Unexpected clock failure");
      },
    );
    try {
      await Bun.sleep(25);
      expect(expired).toBe(true);
    } finally {
      stop();
    }
    let failed = false;
    const stopFailure = watchStreamDeadline(
      replies([]) as never,
      1,
      1,
      () => {},
      () => {
        failed = true;
      },
    );
    try {
      await Bun.sleep(10);
      expect(failed).toBe(true);
    } finally {
      stopFailure();
    }
  });
  test("deadline cleanup suppresses in-flight clock results and errors", async () => {
    for (const reject of [false, true]) {
      let settle: () => void = () => {};
      const clock = {
        send: async () =>
          await new Promise((resolve, fail) => {
            settle = () => (reject ? fail(new Error("Closed connection")) : resolve(["1", "0"]));
          }),
      };
      let callbacks = 0;
      const stop = watchStreamDeadline(
        clock as never,
        1,
        1,
        () => {
          callbacks++;
        },
        () => {
          callbacks++;
        },
      );
      await Bun.sleep(10);
      stop();
      settle();
      await Bun.sleep(5);
      expect(callbacks).toBe(0);
    }
  });
  test("rejects retry delays that cannot be represented safely before accessing Redis", async () => {
    for (const delay of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])
      await expect(
        scheduleStreamRetry(
          replies([]) as never,
          "key",
          { id: "1-0", owner: "owner", payload: "{}" },
          { name: "job", payload: {} },
          delay,
        ),
      ).rejects.toThrow("Invalid Streams retry delay");
  });
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
